
// Global variables
let savedAnswers = [];
let savedFlashcards = [];
let currentHistoryIndex = -1;
let currentQuiz = null;
let quizSubmitted = false;
let abortController = null;
let mediaStream = null; // To store camera stream
let speechUtterance = null; // To store the current speech utterance
let speechText = ''; // Store the full text being spoken
let speechStartTime = 0; // Track when speech started
let speechPausedTime = 0; // Track when speech was paused

// For image input
let selectedImageFile = null; // Stores the image file/blob to send to Gemini
let avatarMediaStream = null; // For avatar camera
let avatarFacingMode = 'user';

// Profile defaults (SVGs provided in Frontend/svg)
const DEFAULT_AVATAR_SVGS = [
  'svg/activity-svgrepo-com.svg',
  'svg/alarm-plus-svgrepo-com.svg',
  'svg/alien-svgrepo-com.svg',
  'svg/bell-svgrepo-com.svg',
  'svg/chef-man-cap-svgrepo-com.svg',
  'svg/cloud-bolt-svgrepo-com.svg',
  'svg/cloud-sun-alt-svgrepo-com.svg',
  'svg/cloud-up-arrow-svgrepo-com.svg',
  'svg/hourglass-half-svgrepo-com.svg',
  'svg/icicles-svgrepo-com.svg',
  'svg/snow-alt-svgrepo-com.svg',
  'svg/turn-off-svgrepo-com.svg',
  'svg/umbrella-svgrepo-com.svg'
];

// Helper to render avatar values properly (emoji vs. image path/URL)
function renderAvatar(avatar) {
  const val = typeof avatar === 'string' ? avatar.trim() : '';
  if (!val) return '👤';
  const isImg = /\.(svg|png|jpg|jpeg|gif|webp)$/i.test(val) || val.startsWith('http') || val.startsWith('data:') || val.startsWith('svg/');
  if (isImg) {
    const safeSrc = val.replace(/"/g, '&quot;');
    return `<img src="${safeSrc}" alt="avatar" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">`;
  }
  // Otherwise assume it's an emoji or short text icon
  return val || '👤';
}

const PROFILE_KEY = 'tutorbotProfile';
const USERNAME_CHANGES_KEY = 'tutorbotUsernameChanges';
const XP_KEY = 'tutorbotXP';
const LEVEL_KEY = 'tutorbotLevel';

function getUserScopedKey(baseKey) {
  try {
    const user = auth && auth.currentUser;
    const uid = user && user.uid ? user.uid : (localStorage.getItem('tutorbotUserEmail') || 'guest');
    return `${baseKey}:${uid}`;
  } catch {
    return `${baseKey}:guest`;
  }
}

// Backend API URL
const BACKEND_URL = 'https://tutorbot-backend.onrender.com';

// --- Daily Usage Limits (Free Plan) ---
const DAILY_LIMITS = {
    responses: 10,
    readAnswers: 5,
    notesGenerated: 5,
    imageSolutions: 4,
    nextQuiz: 2, // For "Next Quiz" button
    refreshQuiz: 3  // For "Refresh Quiz" button
};

// --- Plan-specific Daily Limits ---
const PLAN_LIMITS = {
    free: {
        responses: 10,
        readAnswers: 5,
        notesGenerated: 5,
        imageSolutions: 4,
        nextQuiz: 2,
        refreshQuiz: 3,
        flashcards: 3
    },
    basic: {
        responses: 25,
        readAnswers: 15,
        notesGenerated: 10,
        imageSolutions: 5,
        nextQuiz: 5,
        refreshQuiz: 3,
        flashcards: 5
    },
    standard: {
        responses: 75,
        readAnswers: 50,
        notesGenerated: 25,
        imageSolutions: 15,
        nextQuiz: 15,
        refreshQuiz: 10,
        flashcards: 15
    },
    premium: {
        responses: 99999,
        readAnswers: 99999,
        notesGenerated: 99999,
        imageSolutions: 99999,
        nextQuiz: 99999,
        refreshQuiz: 99999,
        flashcards: 99999
    }
};

let dailyUsage = {
    responses: 0,
    readAnswers: 0,
    notesGenerated: 0,
    imageSolutions: 0,
    nextQuiz: 0,
    refreshQuiz: 0,
    flashcards: 0,
    lastResetDate: ''
};

function getTodayDateString() {
    const today = new Date();
    return today.toDateString();
}

function initializeDailyUsage() {
    const storedUsage = localStorage.getItem('tutorbotDailyUsage');
    const todayDate = getTodayDateString();

    if (storedUsage) {
        dailyUsage = JSON.parse(storedUsage);
        if (dailyUsage.lastResetDate !== todayDate) {
            resetAllDailyUsage(); // It's a new day, reset limits
        }
    } else {
        resetAllDailyUsage(); 
    }
    console.log('Daily Usage Initialized:', dailyUsage);
}

function resetAllDailyUsage() {
    dailyUsage = {
        responses: 0,
        readAnswers: 0,
        notesGenerated: 0,
        imageSolutions: 0,
        nextQuiz: 0,
        refreshQuiz: 0,
        flashcards: 0,
        lastResetDate: getTodayDateString()
    };
    localStorage.setItem('tutorbotDailyUsage', JSON.stringify(dailyUsage));
    console.log('Daily Usage Reset:', dailyUsage);
}


function updateUsage(feature) {
    const user = auth.currentUser;
    if (user) {
        
    }
}

function checkUsage(feature, limit, actionName, outputElement = null) {
    const userPlan = getUserPlan();
    const planLimits = PLAN_LIMITS[userPlan];
    
    if (userPlan === 'premium') return true; // No limits for Premium
    
    if (dailyUsage[feature] >= planLimits[feature]) {
        const planName = userPlan.charAt(0).toUpperCase() + userPlan.slice(1);
        const message = `You've reached your daily limit on the ${planName} plan. Upgrade to a higher plan for more access!`;
        if (outputElement) {
            outputElement.innerHTML = `<div class="limit-message-box">${message}</div>`;
            outputElement.style.display = 'block';
        } else {
            document.getElementById('response').innerHTML = `<div class="limit-message-box">${message}</div>`;
            document.getElementById('response').style.display = 'block';
        }
        return false;
    }
    return true;
}
// --- End Daily Usage Limits ---

async function getAuthToken() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }
  return await user.getIdToken();
}

async function saveAnswerToBackend(question, answer, subject) {
  try {
    const token = await getAuthToken();
    const response = await fetch(`${BACKEND_URL}/api/user-data/save-answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ question, answer, subject })
    });
    
    if (!response.ok) {
      throw new Error('Failed to save answer to backend');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error saving answer to backend:', error);
    throw error;
  }
}

async function loadSavedAnswersFromBackend() {
  try {
    const token = await getAuthToken();
    const response = await fetch(`${BACKEND_URL}/api/user-data/saved-answers`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to load saved answers from backend');
    }
    
    const answers = await response.json();
    savedAnswers = answers.map(item => ({
      question: item.question,
      answer: item.answer,
      timestamp: item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleString() : new Date().toLocaleString(),
      id: item.id
    }));
    
    return savedAnswers;
  } catch (error) {
    console.error('Error loading saved answers from backend:', error);
    // Fallback to localStorage if backend fails
    const stored = localStorage.getItem('tutorbotSavedAnswers');
    if (stored) {
      savedAnswers = JSON.parse(stored);
    }
    return savedAnswers;
  }
}

async function saveFlashcardToBackend(question, answer, subject) {
  try {
    const token = await getAuthToken();
    const response = await fetch(`${BACKEND_URL}/api/user-data/save-flashcard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ question, answer, subject })
    });
    
    if (!response.ok) {
      throw new Error('Failed to save flashcard to backend');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error saving flashcard to backend:', error);
    throw error;
  }
}

async function loadSavedFlashcardsFromBackend() {
  try {
    const token = await getAuthToken();
    const response = await fetch(`${BACKEND_URL}/api/user-data/saved-flashcards`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to load saved flashcards from backend');
    }
    
    const flashcards = await response.json();
    savedFlashcards = flashcards.map(item => ({
      question: item.question,
      answer: item.answer,
      timestamp: item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleString() : new Date().toLocaleString(),
      id: item.id
    }));
    
    return savedFlashcards;
  } catch (error) {
    console.error('Error loading saved flashcards from backend:', error);

    const stored = localStorage.getItem('tutorbotSavedFlashcards');
    if (stored) {
      savedFlashcards = JSON.parse(stored);
    }
    return savedFlashcards;
  }
}

const actionButtons = [
  'askTutorBotBtn', 'voiceInputBtn', 'generateNotesBtn', 'solvePastQuestionBtn',
  'generateQuizBtn', 'generateFlashcardsBtn', 'saveHistoryBtn',
  'prevHistoryBtn', 'nextHistoryBtn', 'submitQuizBtn', 'captureBtn', 'retakeBtn', 'cancelCameraBtn',
  'saveNotesPdfBtn', 'refreshQuizBtn', 'nextQuizBtn' 
];

function setButtonsDisabled(disabled) {
    actionButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) btn.disabled = disabled;
    });
    const stopBtn = document.getElementById('stopGeneratingBtn');
    if (stopBtn) {
        stopBtn.style.display = disabled ? 'block' : 'none';
    }

    updateSpeechControlButtons();
}

/**
 * Navigate to a specific screen in the app.
 * @param {string} id - The ID of the screen to navigate to.
 */
function goToScreen(id) {
  console.log('goToScreen called with id:', id);
  
  const targetScreen = document.getElementById(id);
  if (!targetScreen) {
    console.error('Screen with id ' + id + ' not found!');
    return;
  }
  
  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  // Show requested screen
  targetScreen.classList.add('active');
  
  if (id === 'chatbotScreen') {
    // Place any on-enter-chatbot logic here if needed
  }
}
// ---- Profile Setup & Header ----
function getStoredProfile() {
  const raw = localStorage.getItem(getUserScopedKey(PROFILE_KEY));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function setStoredProfile(profile) {
  localStorage.setItem(getUserScopedKey(PROFILE_KEY), JSON.stringify(profile));
}

function generateUsernameFromEmail(email) {
  const base = (email || 'user').split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'user';
  const rand = Math.floor(Math.random() * 900 + 100);
  return `${base}${rand}`;
}

function getPlanUsernameLimit() {
  const plan = getUserPlan();
  if (plan === 'premium') return 50;
  if (plan === 'standard') return 10;
  if (plan === 'basic') return 3;
  return 1; // free fallback
}

function initializeProfileSetup() {
  const avatarPreview = document.getElementById('profileAvatarPreview');
  if (avatarPreview) avatarPreview.style.backgroundImage = '';
  // Build default icons (SVG list)
  const defaults = document.getElementById('avatarDefaults');
  if (defaults) {
    defaults.innerHTML = '';
    DEFAULT_AVATAR_SVGS.forEach(path => {
      const div = document.createElement('div');
      div.className = 'icon';
      div.style.backgroundImage = `url('${path}')`;
      div.style.backgroundSize = 'cover';
      div.style.backgroundPosition = 'center';
      div.onclick = () => setAvatarFromUrl(path);
      defaults.appendChild(div);
    });
  }
  // propose username
  const input = document.getElementById('usernameInput');
  const email = localStorage.getItem('tutorbotUserEmail') || '';
  if (input) input.value = generateUsernameFromEmail(email);
  const hint = document.getElementById('usernameHint');
  if (hint) hint.textContent = `You can change your username later. Limit: ${getPlanUsernameLimit()} changes.`;
}

function toggleAvatarChooser() {
  const ch = document.getElementById('avatarChooser');
  if (ch) ch.style.display = ch.style.display === 'none' ? 'block' : 'none';
}

function openAvatarDefaults() {
  const el = document.getElementById('avatarDefaults');
  if (el) el.style.display = el.style.display === 'none' ? 'grid' : 'none';
}

function setAvatarFromEmoji(emoji) {
  const avatarPreview = document.getElementById('profileAvatarPreview');
  if (!avatarPreview) return;
  // Render emoji on canvas to get an image URL
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,256,256);
  ctx.font = '180px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 128, 140);
  const dataUrl = canvas.toDataURL('image/png');
  avatarPreview.style.backgroundImage = `url('${dataUrl}')`;
  avatarPreview.dataset.src = dataUrl;
  // Hide placeholder when an avatar is set
  const ph = avatarPreview.querySelector('.avatar-placeholder');
  if (ph) ph.style.display = 'none';
}

function setAvatarFromUrl(url) {
  const avatarPreview = document.getElementById('profileAvatarPreview');
  if (!avatarPreview) return;
  avatarPreview.style.backgroundImage = `url('${url}')`;
  avatarPreview.dataset.src = url;
  const ph = avatarPreview.querySelector('.avatar-placeholder');
  if (ph) ph.style.display = 'none';
}

function renderLetterAvatar(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,256,256);
  grad.addColorStop(0,'#4f46e5');
  grad.addColorStop(1,'#06b6d4');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,256,256);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 170px Poppins, Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 142);
  return canvas.toDataURL('image/png');
}

function handleAvatarFileUpload(event) {
  const file = event.target.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const url = reader.result;
    const avatarPreview = document.getElementById('profileAvatarPreview');
    if (avatarPreview) { avatarPreview.style.backgroundImage = `url('${url}')`; avatarPreview.dataset.src = url; }
  };
  reader.readAsDataURL(file);
}

async function openAvatarCamera() {
  const box = document.getElementById('avatarCamera');
  const video = document.getElementById('avatarCameraStream');
  if (!box || !video) return;
  try {
    avatarMediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: avatarFacingMode } });
    video.srcObject = avatarMediaStream;
    box.style.display = 'block';
  } catch (e) {
    alert('Could not access camera for avatar.');
  }
}

function closeAvatarCamera() {
  const box = document.getElementById('avatarCamera');
  if (avatarMediaStream) { avatarMediaStream.getTracks().forEach(t => t.stop()); avatarMediaStream = null; }
  if (box) box.style.display = 'none';
}

async function toggleAvatarCameraFacing() {
  avatarFacingMode = avatarFacingMode === 'user' ? 'environment' : 'user';
  if (avatarMediaStream) {
    closeAvatarCamera();
    await openAvatarCamera();
    const video = document.getElementById('avatarCameraStream');
    if (video) {
      // Mirror selfie on user front camera for natural POV
      video.style.transform = avatarFacingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
    }
  }
}

function captureAvatarImage() {
  const video = document.getElementById('avatarCameraStream');
  const canvas = document.getElementById('avatarCameraCanvas');
  const avatarPreview = document.getElementById('profileAvatarPreview');
  if (!video || !canvas || !avatarPreview) return;
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.9);
  avatarPreview.style.backgroundImage = `url('${url}')`;
  avatarPreview.dataset.src = url;
  closeAvatarCamera();
}

function saveProfileAndContinue() {
  const avatarPreview = document.getElementById('profileAvatarPreview');
  const usernameInput = document.getElementById('usernameInput');
  const username = (usernameInput && usernameInput.value.trim()) || 'User';
  const avatar = avatarPreview && avatarPreview.dataset.src ? avatarPreview.dataset.src : '';
  
  // Get the selected course from localStorage or courseSelect element
  let course = localStorage.getItem('tutorbotCourse');
  if (!course) {
    const courseSelect = document.getElementById('courseSelect');
    course = courseSelect ? courseSelect.value : 'science';
  }
  
  validateAndSaveUsername(username, avatar, course);
}

async function validateAndSaveUsername(username, avatar, course) {
  try {
    const continueBtn = document.getElementById('profileContinueBtn');
    if (continueBtn) { continueBtn.disabled = true; continueBtn.textContent = 'Saving...'; }
    
    // Wait for auth user during signup (retry briefly)
    let user = auth.currentUser;
    let tries = 0;
    while (!user && tries < 6) {
      await new Promise(r => setTimeout(r, 250));
      user = auth.currentUser; tries++;
    }
    if (!user) {
      console.warn('Auth user not ready; proceeding with local save.');
    }
    
    // Check username availability
    try {
      const token = await getAuthToken();
      const check = await fetch(`${BACKEND_URL}/api/user-data/username-available/${encodeURIComponent(username)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (check.status === 404) {
        console.warn('Username availability route missing (404). Skipping check.');
      } else {
        const data = await check.json();
        if (!data.available) {
          alert('Username already exists. Please choose another.');
          return;
        }
      }
    } catch (e) {
      console.warn('Username availability check failed. Proceeding without check.');
    }
    
    // Save complete profile to backend
    try {
      await saveCompleteProfile(username, avatar, course);
      console.log('Profile saved successfully');
    } catch (error) {
      console.warn('Failed to save complete profile:', error);
    }
    
    // Set up subjects for the selected course
    const subjectSelect = document.getElementById('subject');
    let subjects = [];
    if (course === 'science') {
      subjects = ['Core Maths', 'Physics', 'Chemistry', 'Biology', 'Elective Maths', 'Social Studies', 'Integrated Science', 'English Language','Elective ICT'];
    } else if (course === 'business') {
      subjects = ['Economics', 'Financial Accounting','Business Management', 'Elective Maths', 'Core Maths', 'Integrated Science', 'English Language', 'Social Studies'];
    } else if (course === 'visualArts') {
      subjects = ['Visual Arts', 'Graphic Design', 'General Knowledge in Art', 'Elective Maths', 'Core Maths', 'Integrated Science', 'English Language', 'Social Studies'];
    } else if (course === 'generalArts') {
      subjects = ['Literature', 'History', 'Geography', 'Government', 'Economics', 'Christian Religious Studies', 'Islamic Studies', 'French', 'Core Maths', 'Integrated Science', 'English Language', 'Social Studies','Elective ICT'];
    }
    if (subjectSelect) {
      subjectSelect.innerHTML = subjects.map(sub => `<option value="${sub}">${sub}</option>`).join('');
    }
    
    // Render profile header and go to chatbot
    const profile = { username, avatar, level: getStoredLevel() || 1, xp: getStoredXP() || 0, course, usernameChanges: getStoredUsernameChanges() || 0 };
    renderProfileHeader(profile);
    goToScreen('chatbotScreen');
    
    // Load user data
    await loadUserData();
    
  } catch (e) {
    console.error('Error in validateAndSaveUsername:', e);
    alert('Failed to save profile. Please try again.');
  } finally {
    const continueBtn = document.getElementById('profileContinueBtn');
    if (continueBtn) { continueBtn.disabled = false; continueBtn.textContent = 'Continue'; }
  }
}

function renderProfileHeader(profile) {
  const header = document.getElementById('profileHeader');
  const avatar = document.getElementById('headerAvatar');
  const name = document.getElementById('headerUsername');
  const plan = document.getElementById('headerPlan');
  const levelEl = document.getElementById('headerLevel');
  const xpFill = document.getElementById('headerXpFill');
  const xpText = document.getElementById('headerXpText');
  if (!header) return;
  header.style.display = 'flex';
  if (avatar) avatar.src = profile.avatar || '';
  if (name) name.textContent = profile.username;
  if (plan) plan.textContent = getUserPlan().toUpperCase();
  const level = profile.level || 1;
  const xp = profile.xp || 0;
  const needed = xpNeededForLevel(level);
  const pct = Math.max(0, Math.min(100, Math.floor((xp / needed) * 100)));
  if (levelEl) levelEl.textContent = `Level ${level}`;
  if (xpFill) xpFill.style.width = pct + '%';
  if (xpText) xpText.textContent = `${xp} / ${needed} XP`;
  
  // Add usage display for free users
  updateUsageDisplay();
}

function updateUsageDisplay() {
  const profile = getStoredProfile() || {};
  const plan = profile.plan || 'free';
  
  // Only show usage for free plan
  if (plan !== 'free') {
    const existingDisplay = document.getElementById('usageDisplay');
    if (existingDisplay) existingDisplay.remove();
    return;
  }
  
  const usage = getDailyUsage();
  let existingDisplay = document.getElementById('usageDisplay');
  
  if (!existingDisplay) {
    existingDisplay = document.createElement('div');
    existingDisplay.id = 'usageDisplay';
    existingDisplay.style.cssText = `
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 8px 12px;
      margin: 8px 0;
      font-size: 0.8em;
      color: #94a3b8;
    `;
    
    const container = document.querySelector('.container');
    const profileHeader = document.getElementById('profileHeader');
    if (container && profileHeader) {
      container.insertBefore(existingDisplay, profileHeader.nextSibling);
    }
  }
  
  const usageItems = [
    { key: 'aiResponses', label: 'AI Responses', icon: '🤖' },
    { key: 'notes', label: 'Notes', icon: '📝' },
    { key: 'imageSolutions', label: 'Image Solutions', icon: '📷' },
    { key: 'quizzes', label: 'Quizzes', icon: '🧪' },
    { key: 'flashcards', label: 'Flashcards', icon: '📄' }
  ];
  
  const usageHtml = usageItems.map(item => {
    const current = usage[item.key] || 0;
    const limit = FREE_PLAN_LIMITS[item.key] || 0;
    const remaining = Math.max(0, limit - current);
    const color = remaining === 0 ? '#ef4444' : remaining <= 1 ? '#f59e0b' : '#22c55e';
    
    return `<span style="color:${color}">${item.icon} ${remaining}/${limit}</span>`;
  }).join(' • ');
  
  existingDisplay.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:600;">Daily Limits:</span>
      <button onclick="showUpgradePrompt()" style="background:#a78bfa;color:#fff;border:none;padding:2px 6px;border-radius:4px;font-size:0.7em;cursor:pointer;">Upgrade</button>
    </div>
    <div style="margin-top:4px;">${usageHtml}</div>
  `;
}

function getStoredXP() { return parseInt(localStorage.getItem(getUserScopedKey(XP_KEY)) || '0', 10); }
function setStoredXP(xp) { localStorage.setItem(getUserScopedKey(XP_KEY), String(xp)); }
function getStoredLevel() { return parseInt(localStorage.getItem(getUserScopedKey(LEVEL_KEY)) || '1', 10); }
function setStoredLevel(level) { localStorage.setItem(getUserScopedKey(LEVEL_KEY), String(level)); }
function getStoredUsernameChanges() { return parseInt(localStorage.getItem(getUserScopedKey(USERNAME_CHANGES_KEY)) || '0', 10); }
function setStoredUsernameChanges(n) { localStorage.setItem(getUserScopedKey(USERNAME_CHANGES_KEY), String(n)); }

function xpNeededForLevel(level) {
  if (level <= 1) return 1000;
  if (level === 2) return 3000;
  // Simple growth: 3k, 6k, 10k...
  return Math.min(50000, 1000 + level * level * 500);
}

async function awardXP(amount) {
  let xp = getStoredXP();
  let level = getStoredLevel();
  xp += amount;
  let needed = xpNeededForLevel(level);
  while (xp >= needed) {
    xp -= needed;
    level += 1;
    needed = xpNeededForLevel(level);
  }
  setStoredXP(xp);
  setStoredLevel(level);
  const profile = getStoredProfile();
  if (profile) {
    profile.xp = xp; 
    profile.level = level; 
    setStoredProfile(profile); 
    renderProfileHeader(profile);
    
    // Sync XP and level to backend
    try {
      const token = await getAuthToken();
      await fetch(`${BACKEND_URL}/api/user-data/update-xp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ xp, level })
      });
      console.log('XP and level synced to backend');
    } catch (error) {
      console.warn('Failed to sync XP to backend:', error);
    }
  }
}

// Email verification variables
let verificationEmail = '';
let verificationCode = '';
let storedPassword = '';

async function sendVerificationCode() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  
  if (!email || !password) {
    alert('Please fill in both email and password');
    return;
  }
  
  if (password.length < 6) {
    alert('Password must be at least 6 characters');
    return;
  }
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/email-verification/send-verification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });
    
    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);
    
    const data = await response.json();
    console.log('Response data:', data);
    
    if (response.ok) {
      verificationEmail = email;
      storedPassword = password; // Store the password
      // Show verification code input
      showVerificationStep();
    } else {
      console.error('Error response:', data);
      alert(data.error || 'Failed to send verification code');
    }
  } catch (error) {
    console.error('Error sending verification code:', error);
    alert('Failed to send verification code. Please try again.');
  }
}

function showVerificationStep() {
  // Hide the signup form container
  const signupContainer = document.querySelector('#signupScreen .container');
  if (signupContainer) {
    signupContainer.style.display = 'none';
  }
  
  // Create and show verification form
  const verificationHTML = `
    <div class="verification-form" style="max-width: 400px; margin: 0 auto; padding: 20px; text-align: center;">
      <h2>Verify Your Email</h2>
      <p>We've sent a 6-digit verification code to:</p>
      <p style="font-weight: bold; color: #2563eb;">${verificationEmail}</p>
      <p style="font-size: 14px; color: #666;">Please check your inbox and spam folder</p>
      
      <input type="text" id="verificationCode" placeholder="Enter 6-digit code" maxlength="6" style="width: 100%; padding: 15px; margin: 20px 0; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 18px; text-align: center; letter-spacing: 3px;">
      
      <button onclick="verifyAndSignup()" class="continue-btn" style="width: 100%; padding: 15px; margin: 10px 0; background: #2563eb; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600;">Verify & Sign Up</button>
      
      <button onclick="goBackToSignup()" class="back-btn" style="width: 100%; padding: 15px; margin: 10px 0; background: #6b7280; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px;">← Back to Signup</button>
    </div>
  `;
  
  // Add verification form to the signup screen
  const signupScreen = document.getElementById('signupScreen');
  if (signupScreen) {
    signupScreen.innerHTML += verificationHTML;
  }
}

function goBackToSignup() {
  // Remove verification form
  const verificationForm = document.querySelector('.verification-form');
  if (verificationForm) {
    verificationForm.remove();
  }
  
  // Show signup form container
  const signupContainer = document.querySelector('#signupScreen .container');
  if (signupContainer) {
    signupContainer.style.display = 'block';
  }
  
  // Clear stored data
  verificationEmail = '';
  storedPassword = '';
}

async function verifyAndSignup() {
  const code = document.getElementById('verificationCode').value.trim();
  
  if (!code || code.length !== 6) {
    alert('Please enter a valid 6-digit verification code');
    return;
  }
  
  try {
    // Verify the code
    const verifyResponse = await fetch(`${BACKEND_URL}/api/email-verification/verify-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        email: verificationEmail, 
        code: code 
      })
    });
    
    const verifyData = await verifyResponse.json();
    
    if (verifyResponse.ok) {
      // Code verified, proceed with Firebase signup
      // Use the stored password instead of trying to get it from the hidden form
      const password = storedPassword;
      
      // Show loading message
      const verificationForm = document.querySelector('.verification-form');
      if (verificationForm) {
        verificationForm.innerHTML = `
          <div style="text-align: center; padding: 20px;">
            <h3>Creating your account...</h3>
            <p>Please wait while we set up your TutorBot account.</p>
          </div>
        `;
      }
      
      auth.createUserWithEmailAndPassword(verificationEmail, password)
        .then(() => {
          localStorage.setItem('tutorbotUserEmail', auth.currentUser.email);
          goToScreen('courseScreen');
        })
        .catch(error => {
          alert('Signup failed: ' + error.message);
          goBackToSignup();
        });
    } else {
      alert(verifyData.error || 'Invalid verification code');
    }
  } catch (error) {
    console.error('Error verifying code:', error);
    alert('Failed to verify code. Please try again.');
  }
}

function validateSignup() {
  // This function is now replaced by sendVerificationCode
  sendVerificationCode();
}
async function loginUser() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    try {
      await auth.signInWithEmailAndPassword(email, password);
      localStorage.setItem('tutorbotUserEmail', auth.currentUser.email);
      
      // Clear any previously cached profile for other users
      try {
        const header = document.getElementById('profileHeader');
        if (header) header.style.display = 'none';
      } catch {}
      
      // Check if user has complete profile on backend
      try {
        const userProfile = await loadUserProfile();
        if (userProfile && userProfile.username && userProfile.course) {
          console.log('Existing user with complete profile, going directly to chatbot');
          
          // Set up the course subjects
          const course = userProfile.course;
          const subjectSelect = document.getElementById('subject');
          let subjects = [];
          if (course === 'science') {
            subjects = ['Core Maths', 'Physics', 'Chemistry', 'Biology', 'Elective Maths', 'Social Studies', 'Integrated Science', 'English Language'];
          } else if (course === 'business') {
            subjects = ['Economics', 'Financial Accounting','Business Management', 'Elective Maths', 'Core Maths', 'Integrated Science', 'English Language', 'Social Studies'];
          } else if (course === 'visualArts') {
            subjects = ['Visual Arts', 'Graphic Design', 'General Knowledge in Art', 'Elective Maths', 'Core Maths', 'Integrated Science', 'English Language', 'Social Studies'];
          } else if (course === 'generalArts') {
            subjects = ['Literature', 'History', 'Geography', 'Government', 'Economics', 'Christian Religious Studies', 'Islamic Studies', 'French', 'Core Maths', 'Integrated Science', 'English Language', 'Social Studies'];
          }
          if (subjectSelect) {
            subjectSelect.innerHTML = subjects.map(sub => `<option value="${sub}">${sub}</option>`).join('');
          }
          
          renderProfileHeader(userProfile);
          goToScreen('chatbotScreen');
          await loadUserData();
          return;
        }
      } catch (error) {
        console.warn('Failed to load user profile on login:', error);
      }
      
      // If no complete profile, go to course selection
      console.log('No complete profile found, going to course selection');
      goToScreen('courseScreen');
    } catch (error) {
      document.getElementById('loginError').innerText = error.message;
    }
}

async function saveCourseSelection(course) {
  try {
    const token = await getAuthToken();
    const response = await fetch(`${BACKEND_URL}/api/user-data/course`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ course })
    });
    
    if (!response.ok) {
      throw new Error('Failed to save course selection');
    }
    
    console.log('Course selection saved:', course);
    return await response.json();
  } catch (error) {
    console.error('Error saving course selection:', error);
    // Fallback to localStorage
    localStorage.setItem('tutorbotCourse', course);
    throw error;
  }
}

async function loadUserProfile() {
  try {
    const token = await getAuthToken();
    const response = await fetch(`${BACKEND_URL}/api/user-data/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        console.log('No user profile found on backend');
        return null;
      }
      throw new Error('Failed to load user profile');
    }
    
    const profile = await response.json();
    console.log('User profile loaded from backend:', profile);
    
    // Store locally as cache
    setStoredProfile(profile);
    if (profile.level) setStoredLevel(profile.level);
    if (profile.xp) setStoredXP(profile.xp);
    
    return profile;
  } catch (error) {
    console.error('Error loading user profile:', error);
    // Fallback to localStorage
    return getStoredProfile();
  }
}

async function saveCompleteProfile(username, avatar, course) {
  try {
    const token = await getAuthToken();
    const level = getStoredLevel() || 1;
    const xp = getStoredXP() || 0;
    
    const profileData = {
      username,
      avatar,
      course,
      level,
      xp
    };
    
    const response = await fetch(`${BACKEND_URL}/api/user-data/complete-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(profileData)
    });
    
    if (!response.ok) {
      throw new Error('Failed to save complete profile');
    }
    
    console.log('Complete profile saved to backend');
    
    // Also save locally
    const profile = { username, avatar, level, xp, course, usernameChanges: getStoredUsernameChanges() || 0 };
    setStoredProfile(profile);
    
    return await response.json();
  } catch (error) {
    console.error('Error saving complete profile:', error);
    // Fallback to local save
    const profile = { username, avatar, level: getStoredLevel() || 1, xp: getStoredXP() || 0, course, usernameChanges: getStoredUsernameChanges() || 0 };
    setStoredProfile(profile);
    throw error;
  }
}

async function loadUserData() {
  try {
    if (auth.currentUser) {
      // Load saved answers and flashcards from backend
      await loadSavedAnswersFromBackend();
      await loadSavedFlashcardsFromBackend();
      console.log('User data loaded successfully');
    }
  } catch (error) {
    console.error('Error loading user data:', error);
  }
}

async function startTutorBot() {
  console.log('startTutorBot called');
  const course = document.getElementById('courseSelect').value;
  console.log('Selected course:', course);
  
  // Store course selection on backend
  try {
    await saveCourseSelection(course);
  } catch (error) {
    console.warn('Failed to save course selection:', error);
  }
  
  const subjectSelect = document.getElementById('subject');
  let subjects = [];
  if (course === 'science') {
    subjects = ['Core Maths', 'Physics', 'Chemistry', 'Biology', 'Elective Maths', 'Social Studies', 'Integrated Science', 'English Language'];
  } else if (course === 'business') {
    subjects = ['Economics', 'Financial Accounting','Business Management', 'Elective Maths', 'Core Maths', 'Integrated Science', 'English Language', 'Social Studies'];
  } else if (course === 'visualArts') {
    subjects = ['Visual Arts', 'Graphic Design', 'General Knowledge in Art', 'Elective Maths', 'Core Maths', 'Integrated Science', 'English Language', 'Social Studies'];
  } else if (course === 'generalArts') {
    subjects = ['Literature', 'History', 'Geography', 'Government', 'Economics', 'Christian Religious Studies', 'Islamic Studies', 'French', 'Core Maths', 'Integrated Science', 'English Language', 'Social Studies'];
  }
  subjectSelect.innerHTML = subjects.map(sub => `<option value="${sub}">${sub}</option>`).join('');
  
  // Check if user has complete profile on backend
  try {
    const userProfile = await loadUserProfile();
    if (userProfile && userProfile.username && userProfile.course) {
      console.log('User has complete profile, going to chatbot');
      renderProfileHeader(userProfile);
      goToScreen('chatbotScreen');
      await loadUserData();
      return;
    }
  } catch (error) {
    console.warn('Failed to load user profile:', error);
  }
  
  // If no complete profile, go to profile setup
  console.log('No complete profile found, going to profile setup');
  goToScreen('profileScreen');
  initializeProfileSetup();
}

function stopProcess() {
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
    if (window.speechSynthesis.speaking || window.speechSynthesis.paused) {
        window.speechSynthesis.cancel();
        // Reset speechUtterance to null when explicitly stopped
        speechUtterance = null;
        updateSpeechControlButtons(); // Update buttons after stopping speech
    }
    setButtonsDisabled(false);
    document.querySelectorAll('.response-box, .notes-section, .past-question-solver-box, .quiz-section, .flashcards').forEach(box => {
        if (box.innerText.includes('...')) {
            if (box.id === 'response') box.innerText = "Ask a question to see TutorBot's response here...";
            else if (box.id === 'notes-box') box.innerText = "Notes will appear here...";
            else if (box.id === 'past-question-solution-box') box.innerText = "Solution will appear here...";
            else if (box.id === 'quiz-box') box.innerText = "Quiz questions will appear here...";
            else if (box.id === 'flashcard-box') box.innerText = "Flashcard will appear here...";
            box.style.display = 'none';
        }
    });
    // Hide specific buttons if their content is cleared/stopped
    document.getElementById('saveNotesPdfBtn').style.display = 'none';
    document.getElementById('quizControlButtons').style.display = 'none';
    console.log('Process stopped by user.');

}



async function callGeminiAPI(promptParts, outputElement, loadingMessage) {
    outputElement.innerHTML = `<em>${loadingMessage}</em>`;
    outputElement.style.display = 'block';
    setButtonsDisabled(true);

    abortController = new AbortController();
    const signal = abortController.signal;

    // Set a timeout for the request (2 minutes for image processing, 1 minute for text)
    const isImageRequest = promptParts.some(part => part.inlineData);
    const timeoutMs = isImageRequest ? 120000 : 60000; // 2 min for images, 1 min for text
       
    const timeoutId = setTimeout(() => {
        abortController.abort();
    }, timeoutMs);

    try {
        const user = auth.currentUser;
        if (!user) {
            outputElement.innerText = "You must be signed in to use TutorBot features.";
            return null;
        }
        const idToken = await user.getIdToken();
       
        console.log('Current hostname:', window.location.hostname);
        const API_BASE = BACKEND_URL;
        console.log('Using API_BASE:', API_BASE);
        console.log('Request timeout:', timeoutMs + 'ms');

        const response = await fetch(`${API_BASE}/api/ai/gemini`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + idToken
            },
            body: JSON.stringify({ promptParts }),
            signal: signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.json();
            } catch (jsonError) {
                // If response is not JSON (e.g., HTML error page), get text
                const errorText = await response.text();
                console.error('Non-JSON error response:', errorText);
                outputElement.innerText = `Server Error (${response.status}): The server returned an error page. Please try again later.`;
                return null;
            }
            outputElement.innerText = `Error: ${errorData.error || 'An unknown API error occurred.'}`;
            return null;
        }

        let data;
        try {
            data = await response.json();
        } catch (jsonError) {
            console.error('Invalid JSON response:', await response.text());
            outputElement.innerText = 'Server returned invalid response. Please try again.';
            return null;
        }
        if (data.text) {
            return data.text;
        } else {
            outputElement.innerText = "No content generated.";
            return null;
        }
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            if (abortController.signal.aborted) {
                outputElement.innerText = "Request timed out. Please try again with a smaller image or check your connection.";
            } else {
            outputElement.innerText = "Generation cancelled by user.";
            }
        } else {
            outputElement.innerText = `An unexpected error occurred: ${error.message}. Please try again.`;
        }
        return null;
    } finally {
        abortController = null;
        setButtonsDisabled(false);
    }
}

async function getResponse() {
  console.log('getResponse() called');
  const responseBox = document.getElementById('response');

  // Check usage limit for free plan
  const limitCheck = checkUsageLimit('aiResponses');
  if (!limitCheck.allowed) {
    showUpgradePromptForLimit('aiResponses');
    return;
  }

  const subject = document.getElementById('subject').value;
  const question = document.getElementById('question').value.trim();
  console.log('Subject:', subject, 'Question:', question);

  if (!question) {
      responseBox.innerText = "Please enter your question in the 'Your Question' box.";
      responseBox.style.display = 'block';
      return;
  }

  let promptText = `As a smart SHS AI Assistant for Ghanaian students specializing in ${subject}, explain the following concept or answer the question to a Senior High School student. Ensure the language is clear, concise, and aligned with WAEC standards, using relevant Ghanaian or West African examples where appropriate:\n\n"${question}".`;

  if (document.getElementById('simplify').checked) {
      promptText += ` After your detailed explanation, provide a simpler, more concise explanation for easier understanding, clearly labeled "Simplified Version:".`;
  }

  console.log('Calling Gemini API...');
  const promptParts = [{ text: promptText }];
  const answer = await callGeminiAPI(promptParts, responseBox, "Thinking deeply for your answer...");
  if (answer) {
      let cleanAnswer = answer.replace(/\*/g, ''); 
      responseBox.innerText = cleanAnswer;
      updateSpeechControlButtons(); 
      incrementUsage('aiResponses'); 
      awardXP(50);
      
      // Update achievement stats
      updateAchievementStat('questionsAsked');
      updateAchievementStat('dailyQuestions');
      
      console.log('Response generated successfully');
  } else {
      console.log('No answer received from API');
  }
}
async function generateFlashcards() {
  const flashcardBox = document.getElementById('flashcard-box');

  // Check usage limit for free plan
  const limitCheck = checkUsageLimit('flashcards');
  if (!limitCheck.allowed) {
    showUpgradePromptForLimit('flashcards');
    return;
  }

  const question = document.getElementById('question').value.trim();
  const subject = document.getElementById('subject').value;

  if (!question) {
    flashcardBox.innerText = "Enter a core concept or question in the 'Your Question' box first to generate a flashcard.";
    flashcardBox.style.display = 'block';
    return;
  }

  const promptText = `Generate a single flashcard (Question and Answer) based on the following core concept or question for an SHS student in ${subject}. Ensure it's relevant to the Ghanaian SHS curriculum and WAEC exams. Format it exactly as:\n\nQuestion: [Your Flashcard Question Here]\nAnswer: [Your Detailed Flashcard Answer Here]\n\nCore Concept/Question: "${question}"`;

  const promptParts = [{ text: promptText }];
  const flashcardContent = await callGeminiAPI(promptParts, flashcardBox, "Crafting your flashcard...");
  if (flashcardContent) {
      flashcardBox.innerHTML = `<strong>Flashcard Generated:</strong><br>${flashcardContent}<br><br><button onclick="saveFlashcard()" class="continue-btn" style="margin-top: 10px;">💾 Save Flashcard</button>`;
      incrementUsage('flashcards');
      awardXP(20);
      
      // Update achievement stats
      updateAchievementStat('flashcardsGenerated');
  }
}

async function saveFlashcard() {
  const flashcardBox = document.getElementById('flashcard-box');
  const flashcardContent = flashcardBox.innerText;
  const subject = document.getElementById('subject').value;
  const question = document.getElementById('question').value.trim();

  if (!flashcardContent || flashcardContent.includes("Enter a core concept") || flashcardContent.includes("Crafting your flashcard")) {
    alert('No valid flashcard to save. Please generate a flashcard first.');
    return;
  }

  try {
    // Extract question and answer from flashcard content
    const questionMatch = flashcardContent.match(/Question:\s*(.+?)(?=\n|$)/);
    const answerMatch = flashcardContent.match(/Answer:\s*(.+?)(?=\n|$)/);
    
    if (!questionMatch || !answerMatch) {
      alert('Could not parse flashcard content. Please try generating a new flashcard.');
      return;
    }

    const flashcardQuestion = questionMatch[1].trim();
    const flashcardAnswer = answerMatch[1].trim();

    // Save to backend
    await saveFlashcardToBackend(flashcardQuestion, flashcardAnswer, subject);
    
    // Also save to localStorage as backup
    savedFlashcards.push({ 
      question: flashcardQuestion, 
      answer: flashcardAnswer, 
      timestamp: new Date().toLocaleString() 
    });
    localStorage.setItem('tutorbotSavedFlashcards', JSON.stringify(savedFlashcards));
    
    alert('Flashcard saved successfully!');
  } catch (error) {
    console.error('Error saving flashcard:', error);
    alert('Failed to save flashcard. Please try again.');
  }
}

async function generateNotes() {
  const notesBox = document.getElementById('notes-box');
  
  // Check usage limit for free plan
  const limitCheck = checkUsageLimit('notes');
  if (!limitCheck.allowed) {
    showUpgradePromptForLimit('notes');
    document.getElementById('saveNotesPdfBtn').style.display = 'none';
    return;
  }

  const subject = document.getElementById('subject').value;
  const notesTopic = document.getElementById('notesTopic').value.trim();
  const saveNotesPdfBtn = document.getElementById('saveNotesPdfBtn');

  if (!notesTopic) {
      notesBox.innerText = "Please enter a specific topic in the 'Generate Notes on Topic' field.";
      notesBox.style.display = 'block';
      saveNotesPdfBtn.style.display = 'none'; // Hide PDF button if no topic
      return;
  }

  const promptText = `Generate comprehensive and concise notes for an SHS student in Ghana studying ${subject}, specifically on the topic of "${notesTopic}". Structure the notes clearly with headings, bullet points, and key definitions. Focus on content relevant to the WAEC syllabus.`;

  const promptParts = [{ text: promptText }];
  const notesContent = await callGeminiAPI(promptParts, notesBox, `Generating detailed notes on "${notesTopic}" for ${subject}...`);
  if (notesContent) {
      notesBox.innerHTML = `<strong>Notes on "${notesTopic}" (${subject}):</strong><br>${notesContent}`;
      saveNotesPdfBtn.style.display = 'block'; // Show PDF button if notes generated
      incrementUsage('notes'); // Increment usage count on successful generation
      awardXP(30);
  } else {
      saveNotesPdfBtn.style.display = 'none'; // Hide if no notes
  }
}


function saveNotesAsPdf() {
  const notesBox = document.getElementById('notes-box');
  const notesTopic = document.getElementById('notesTopic').value.trim();
  const subject = document.getElementById('subject').value;
  const notesContent = notesBox.innerText;

  if (!notesContent || notesContent.includes("Generating detailed notes") || notesContent.includes("Please enter a specific topic") || notesContent.includes("You've reached your daily limit") || notesContent.trim() === '') {
      notesBox.innerHTML = `<div class="limit-message-box">No valid notes to save. Please generate notes first.</div>`;
      notesBox.style.display = 'block';
      return;
  }

  // Using jspdf library
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text(`Notes on ${notesTopic} (${subject})`, 10, 20);
  doc.setFontSize(12);

  const splitText = doc.splitTextToSize(notesContent, 180); 
  doc.text(splitText, 10, 30);

  const filename = `${notesTopic}_Notes_${subject}.pdf`.replace(/[^a-zA-Z0-9_.-]/g, '_'); 
  doc.save(filename);

}

async function solvePastQuestion() {
  const solutionBox = document.getElementById('past-question-solution-box');
  
  // Check usage limit for free plan
  const limitCheck = checkUsageLimit('imageSolutions');
  if (!limitCheck.allowed) {
    showUpgradePromptForLimit('imageSolutions');
    return;
  }

  const subject = document.getElementById('subject').value;

  if (!selectedImageFile) {
      solutionBox.innerText = "Please capture or upload an image of the WAEC past question first.";
      solutionBox.style.display = 'block';
      return;
  }

  try {
    let base64Data, mimeType;
    
    if (selectedImageFile.type === 'application/pdf') {
      // Handle PDF files - convert first page to image
      console.log('Processing PDF file...');
      const pdfImage = await convertPdfToImage(selectedImageFile);
      if (!pdfImage) {
        solutionBox.innerText = "Failed to process PDF. Please try with an image file instead.";
        solutionBox.style.display = 'block';
        return;
      }
      base64Data = pdfImage;
      mimeType = 'image/jpeg';
    } else {
      // Handle image files
      console.log('Processing image file...');
  const base64Image = await fileToBase64(selectedImageFile);
  if (!base64Image) {
      solutionBox.innerText = "Failed to process image. Please try again with a different image.";
        solutionBox.style.display = 'block';
      return;
      }
      base64Data = base64Image;
      mimeType = selectedImageFile.type;
  }

    console.log('File processed, sending to API...');

  const promptText = `You are a highly experienced SHS teacher in Ghana specializing in ${subject}. Analyze the image provided, which contains a WAEC past question. Provide a detailed, step-by-step solution or explanation for this question. Your answer should be comprehensive, accurate, and structured in a way that matches typical WAEC mark schemes, clearly showing working or reasoning, suitable for a Ghanaian SHS student.`;

  // Multimodal prompt: array of parts including text and image
  const promptParts = [
      { text: promptText },
      {
          inlineData: {
                mimeType: mimeType,
                data: base64Data.split(',')[1] // Get base64 data after 'data:image/jpeg;base64,'
          }
      }
  ];

    console.log('Sending multimodal request to API...');
  const solutionContent = await callGeminiAPI(promptParts, solutionBox, "Analyzing image and preparing detailed WAEC solution...");
    
  if (solutionContent) {
      solutionBox.innerHTML = `<strong>Solution for WAEC Past Question:</strong><br>${solutionContent}`;
      incrementUsage('imageSolutions'); 
        console.log('Solution received successfully');
        awardXP(40);
    } else {
        solutionBox.innerText = "Failed to generate solution. Please try again.";
        solutionBox.style.display = 'block';
    }
  } catch (error) {
    console.error('Error in solvePastQuestion:', error);
    solutionBox.innerText = `Error processing image: ${error.message}. Please try again.`;
    solutionBox.style.display = 'block';
  }
}

async function generateQuiz(isNextQuiz = false) {
  const quizBox = document.getElementById('quiz-box');
  const quizControlButtons = document.getElementById('quizControlButtons');

  // Check usage limit for free plan
  const limitCheck = checkUsageLimit('quizzes');
  if (!limitCheck.allowed) {
    showUpgradePromptForLimit('quizzes');
    quizControlButtons.style.display = 'none';
    return;
  }

  const subject = document.getElementById('subject').value;
  const quizTopic = document.getElementById('quizTopic').value.trim();

  quizBox.style.display = 'block';
  currentQuiz = null;
  quizSubmitted = false;

  let topicPrompt = quizTopic ? `on the specific topic of "${quizTopic}"` : '';
  if (isNextQuiz) {
      topicPrompt += ` Generate different questions from previously generated ones, exploring varied aspects of the topic/subject.`;
  }

  const promptText = `Generate 10 multiple-choice WAEC-style quiz questions for an SHS student in Ghana studying ${subject} ${topicPrompt}.
      For each question, provide exactly 4 options (A, B, C, D) and clearly state the correct answer at the end of the question block.
      Format each question block exactly as follows, without extra text or numbering outside this format:
      Question [Number]: [Question Text]
      A) [Option A Text]
      B) [Option B Text]
      C) [Option C Text]
      D) [Option D Text]
      Correct Answer: [A/B/C/D]
      `;

  const promptParts = [{ text: promptText }];
  const quizContent = await callGeminiAPI(promptParts, quizBox, `Generating 10 WAEC-style quiz questions for ${subject} ${topicPrompt}...`);

  if (quizContent) {
      currentQuiz = parseQuizResponse(quizContent);

      if (currentQuiz.length === 0) {
          quizBox.innerText = "Could not parse quiz questions from API response. The model might have had trouble formatting the questions correctly. Please try again.";
          quizControlButtons.style.display = 'none'; // Hide controls if parsing fails
          return;
      }
      renderQuiz(currentQuiz);
      quizControlButtons.style.display = 'flex'; // Show controls once quiz is rendered
      incrementUsage('quizzes');
  } else {
      quizControlButtons.style.display = 'none'; // Hide if API call fails
  }
}

function parseQuizResponse(quizText) {
  const questions = [];
  const rawQuestions = quizText.split(/Question \d+:\s*/).filter(Boolean).slice(1);

  rawQuestions.forEach(rawQ => {
      const lines = rawQ.trim().split('\n').filter(line => line.trim() !== '');
      if (lines.length < 6) return;

      const questionText = lines[0].trim();
      const options = {};
      let correctOption = '';

      for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.match(/^[A-D]\)/)) {
              options[line.charAt(0)] = line.substring(2).trim();
          } else if (line.startsWith('Correct Answer:')) {
              correctOption = line.substring('Correct Answer:'.length).trim().charAt(0);
          }
      }

      if (questionText && Object.keys(options).length === 4 && correctOption && ['A','B','C','D'].includes(correctOption)) {
          questions.push({
              question: questionText,
              options: options,
              correctAnswer: correctOption
          });
      }
  });
  return questions;
}

function renderQuiz(quizData) {
  const quizBox = document.getElementById('quiz-box');
  let quizHtml = `<strong>Daily WAEC Quiz for ${document.getElementById('subject').value}:</strong><br><br>`;

  if (document.getElementById('quizTopic').value.trim()) {
      quizHtml += `<em>Topic: ${document.getElementById('quizTopic').value.trim()}</em><br><br>`;
  }

  quizData.forEach((q, index) => {
    quizHtml += `
      <div class="quiz-question" id="quiz-question-${index}">
        <strong>${index + 1}. ${q.question}</strong><br>`;
    ['A', 'B', 'C', 'D'].forEach(optKey => {
      quizHtml += `<label><input type="radio" name="q${index}" value="${optKey}" /> ${optKey}) ${q.options[optKey]}</label><br>`;
    });
    quizHtml += `</div>`;
  });

  quizHtml += `<button class="continue-btn" onclick="submitQuiz()" id="submitQuizBtn">Submit Quiz</button>`;
  quizBox.innerHTML = quizHtml;
  document.getElementById('submitQuizBtn').disabled = false;
}

function submitQuiz() {
  if (quizSubmitted) return;
  quizSubmitted = true;
  document.getElementById('submitQuizBtn').disabled = true;

  const quizBox = document.getElementById('quiz-box');
  let score = 0;
  const totalQuestions = currentQuiz.length;

  currentQuiz.forEach((q, index) => {
    const selectedOption = document.querySelector(`input[name="q${index}"]:checked`);
    const questionDiv = document.getElementById(`quiz-question-${index}`);

    let userChoice = selectedOption ? selectedOption.value : 'Not Answered';

    questionDiv.querySelectorAll('input[type="radio"]').forEach(radio => radio.disabled = true);

    let feedbackText = '';
    if (userChoice === q.correctAnswer) {
      score++;
      questionDiv.style.backgroundColor = 'rgba(60, 179, 113, 0.2)';
      feedbackText = `<span class="quiz-answer-correct">Correct!</span>`;
    } else {
      questionDiv.style.backgroundColor = 'rgba(255, 99, 71, 0.2)';
      feedbackText = `<span class="quiz-answer-incorrect">Incorrect.</span> The correct answer was ${q.correctAnswer}).`;
    }

    questionDiv.innerHTML += `<div class="quiz-feedback-text">${feedbackText}</div>`;
  });

  quizBox.innerHTML += `<div class="quiz-results">You scored ${score} out of ${totalQuestions}!</div>`;
}

async function saveHistory() {
  const question = document.getElementById('question').value.trim();
  const answer = document.getElementById('response').innerText.trim();
  const subject = document.getElementById('subject').value;
  const historyBox = document.getElementById('history-box');
  const historyNavButtons = document.getElementById('historyNavButtons');

  if (!question || answer === "Ask a question to see TutorBot's response here..." || answer.startsWith("Thinking...") || answer.startsWith("Error:") || answer.includes("You've reached your daily limit") || answer.trim() === '') {
    historyBox.style.display = 'block';
    historyBox.innerText = "Nothing valid to save yet. Ask a question and get a response first.";
    historyNavButtons.style.display = 'none';
    return;
  }

  try {
    // Save to backend
    await saveAnswerToBackend(question, answer, subject);
    
    // Also save to localStorage as backup
    savedAnswers.push({ question: question, answer: answer, timestamp: new Date().toLocaleString() });
    currentHistoryIndex = savedAnswers.length - 1;
    localStorage.setItem('tutorbotSavedAnswers', JSON.stringify(savedAnswers));

    displaySavedAnswer();
    historyBox.style.display = 'block';
    historyNavButtons.style.display = 'flex';
    updateHistoryNavButtons();
    
    alert('Answer saved successfully!');
  } catch (error) {
    console.error('Error saving answer:', error);
    alert('Failed to save answer. Please try again.');
  }
}

function displaySavedAnswer() {
  const historyBox = document.getElementById('history-box');
  if (savedAnswers.length > 0 && currentHistoryIndex >= 0 && currentHistoryIndex < savedAnswers.length) {
    const item = savedAnswers[currentHistoryIndex];
    historyBox.innerHTML = `<strong>Saved Answer ${currentHistoryIndex + 1} of ${savedAnswers.length} (${item.timestamp}):</strong><br>Q: ${item.question}<br>A: ${item.answer}`;
  } else {
    historyBox.innerText = "No saved answers to display.";
  }
}

function updateHistoryNavButtons() {
  const prevBtn = document.getElementById('prevHistoryBtn');
  const nextBtn = document.getElementById('nextHistoryBtn');

  prevBtn.disabled = currentHistoryIndex <= 0;
  nextBtn.disabled = currentHistoryIndex >= savedAnswers.length - 1;
}

function navigateHistory(direction) {
  currentHistoryIndex += direction;
  displaySavedAnswer();
  updateHistoryNavButtons();
}

// Flashcard navigation variables
let currentFlashcardIndex = -1;

async function loadSavedFlashcards() {
  try {
    await loadSavedFlashcardsFromBackend();
    if (savedFlashcards.length > 0) {
      currentFlashcardIndex = 0;
      displaySavedFlashcard();
      document.getElementById('flashcard-history-box').style.display = 'block';
      document.getElementById('flashcardNavButtons').style.display = 'flex';
      updateFlashcardNavButtons();
    } else {
      document.getElementById('flashcard-history-box').innerText = "No saved flashcards found.";
      document.getElementById('flashcard-history-box').style.display = 'block';
      document.getElementById('flashcardNavButtons').style.display = 'none';
    }
  } catch (error) {
    console.error('Error loading saved flashcards:', error);
    alert('Failed to load saved flashcards. Please try again.');
  }
}

function displaySavedFlashcard() {
  const flashcardBox = document.getElementById('flashcard-history-box');
  if (savedFlashcards.length > 0 && currentFlashcardIndex >= 0 && currentFlashcardIndex < savedFlashcards.length) {
    const item = savedFlashcards[currentFlashcardIndex];
    flashcardBox.innerHTML = `<strong>Saved Flashcard ${currentFlashcardIndex + 1} of ${savedFlashcards.length} (${item.timestamp}):</strong><br><br><strong>Question:</strong> ${item.question}<br><br><strong>Answer:</strong> ${item.answer}`;
  } else {
    flashcardBox.innerText = "No saved flashcards to display.";
  }
}

function updateFlashcardNavButtons() {
  const prevBtn = document.getElementById('prevFlashcardBtn');
  const nextBtn = document.getElementById('nextFlashcardBtn');

  prevBtn.disabled = currentFlashcardIndex <= 0;
  nextBtn.disabled = currentFlashcardIndex >= savedFlashcards.length - 1;
}

function navigateFlashcards(direction) {
  currentFlashcardIndex += direction;
  displaySavedFlashcard();
  updateFlashcardNavButtons();
}

// --- Speech Synthesis Controls ---
function updateSpeechControlButtons() {
  const speakBtn = document.getElementById('speakAnswerBtn');
  const pauseBtn = document.getElementById('pauseSpeechBtn');
  const resumeBtn = document.getElementById('resumeSpeechBtn');
  const responseBox = document.getElementById('response');

  const hasAnswerText = responseBox.innerText &&
                        !responseBox.innerText.startsWith("Ask a question to see TutorBot's response here...") &&
                        !responseBox.innerText.startsWith("Thinking...") &&
                        !responseBox.innerText.startsWith("Error:") &&
                        !responseBox.innerText.includes("You've reached your daily limit");

  if (!hasAnswerText) {
      speakBtn.style.display = 'inline-block';
      pauseBtn.style.display = 'none';
      resumeBtn.style.display = 'none';
      return;
  }

  // Check if speech synthesis is supported
  if (!window.speechSynthesis) {
      speakBtn.style.display = 'inline-block';
      pauseBtn.style.display = 'none';
      resumeBtn.style.display = 'none';
      return;
  }

  // Check if mobile device
  const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile) {
      // On mobile: only show speak button, never show pause/resume
      speakBtn.style.display = 'inline-block';
      pauseBtn.style.display = 'none';
      resumeBtn.style.display = 'none';
  } else {
      // On desktop: show pause/resume when speaking
      if (window.speechSynthesis.speaking) {
          speakBtn.style.display = 'none';
          pauseBtn.style.display = 'inline-block';
          resumeBtn.style.display = 'inline-block';
      } else {
          speakBtn.style.display = 'inline-block';
          pauseBtn.style.display = 'none';
          resumeBtn.style.display = 'none';
      }
  }
}

function speakAnswer() {
    const responseBox = document.getElementById('response');
    
    // Check daily usage limit
    if (!checkUsage('readAnswers', DAILY_LIMITS.readAnswers, 'read answers', responseBox)) {
        updateSpeechControlButtons();
        return;
    }

    const answerText = document.getElementById('response').innerText;
    if (!answerText || answerText.startsWith("Ask a question to see TutorBot's response here...") || answerText.startsWith("Thinking...") || answerText.startsWith("Error:")) {
        responseBox.innerHTML = `<div class="limit-message-box">No valid answer available to read aloud.</div>`;
        responseBox.style.display = 'block';
        updateSpeechControlButtons();
        return;
    }

    // Check if speech synthesis is supported
    if (!window.speechSynthesis) {
        responseBox.innerHTML = `<div class="limit-message-box">Speech synthesis not supported on this device.</div>`;
        responseBox.style.display = 'block';
        return;
    }

    // Cancel any existing speech
    if (window.speechSynthesis.speaking || window.speechSynthesis.paused) {
        window.speechSynthesis.cancel();
    }

    // Store the text for potential restart
    speechText = answerText;

    speechUtterance = new SpeechSynthesisUtterance(answerText);
    
    // Mobile-specific settings
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        speechUtterance.rate = 0.8; // Slower for mobile
        speechUtterance.pitch = 1.0;
        speechUtterance.volume = 1.0;
    } else {
        speechUtterance.rate = 1.0;
        speechUtterance.pitch = 1.0;
    }

    speechUtterance.onstart = () => {
        console.log('Speech started');
        updateSpeechControlButtons();
    };

    speechUtterance.onend = () => {
        console.log('Speech ended');
        speechUtterance = null;
        speechText = '';
        updateSpeechControlButtons();
    };
    
    speechUtterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
        speechUtterance = null;
        speechText = '';
        
        // Mobile-specific error handling
        if (isMobile) {
            responseBox.innerHTML = `<div class="limit-message-box">Speech may not work on mobile. Try on desktop for better experience.</div>`;
        } else {
            responseBox.innerHTML = `<div class="limit-message-box">Speech playback error: ${event.error}.</div>`;
        }
        responseBox.style.display = 'block';
        updateSpeechControlButtons();
    };

  
    try {
       
        if (isMobile) {
            // Forced a small delay for mobile to ensure user interaction
            setTimeout(() => {
                window.speechSynthesis.speak(speechUtterance);
                updateUsage('readAnswers');
            }, 100);
        } else {
            window.speechSynthesis.speak(speechUtterance);
            updateUsage('readAnswers');
        }
    } catch (error) {
        console.error('Speech synthesis failed:', error);
        if (isMobile) {
            responseBox.innerHTML = `<div class="limit-message-box">Speech not available on mobile. Use desktop for full features.</div>`;
        } else {
            responseBox.innerHTML = `<div class="limit-message-box">Speech synthesis not available on this device.</div>`;
        }
        responseBox.style.display = 'block';
    }
}

function pauseSpeech() {
    // Disable pause on mobile devices
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        console.log('Pause not available on mobile');
        return;
    }
    
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        console.log('Speech paused');
    }
}

function resumeSpeech() {
    // Disable resume on mobile devices
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        console.log('Resume not available on mobile');
        return;
    }
    
    if (window.speechSynthesis && window.speechSynthesis.paused) {
        // Tried to resume normally first
        try {
            window.speechSynthesis.resume();
            console.log('Speech resumed normally');
        } catch (error) {
            console.log('Resume failed, restarting speech');
            // If resume failed, restart the speech from beginning
            if (speechText) {
                window.speechSynthesis.cancel();
                const newUtterance = new SpeechSynthesisUtterance(speechText);
                
                // Applied same settings
                if (isMobile) {
                    newUtterance.rate = 0.8;
                    newUtterance.pitch = 1.0;
                    newUtterance.volume = 1.0;
                } else {
                    newUtterance.rate = 1.0;
                    newUtterance.pitch = 1.0;
                }
                
                newUtterance.onend = () => {
                    speechUtterance = null;
                    speechText = '';
                    updateSpeechControlButtons();
                };
                
                speechUtterance = newUtterance;
                window.speechSynthesis.speak(newUtterance);
            }
        }
    }
}

function startVoiceInput() {
  const questionBox = document.getElementById('question');
  if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
      alert('Your browser does not support Speech Recognition. Please use Chrome or Edge for voice input.');
      return;
  }

  const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  const microphoneButton = document.getElementById('voiceInputBtn'); // Get by ID
  microphoneButton.innerText = "🔴 Listening...";
  microphoneButton.style.backgroundColor = '#ef4444';
  setButtonsDisabled(true); // Temporarily disable all, then re-enable specific ones

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    questionBox.value = transcript;
    microphoneButton.innerText = "🎤 Voice Input";
    microphoneButton.style.backgroundColor = '#facc15';
    setButtonsDisabled(false);
  };

  recognition.onerror = function(event) {
    alert('Voice input failed: ' + event.error);
    microphoneButton.innerText = "🎤 Voice Input";
    microphoneButton.style.backgroundColor = '#facc15';
    setButtonsDisabled(false);
  };

  recognition.onend = function() {
    microphoneButton.innerText = "🎤 Voice Input";
    microphoneButton.style.backgroundColor = '#facc15';
    setButtonsDisabled(false);
  };

  recognition.start();
}

// --- Image Input Handling Functions ---

async function openCamera() {
  const solutionBox = document.getElementById('past-question-solution-box');
  // Don't check usage limit when opening camera - only when actually solving
  // This prevents the "generating" state from being triggered

  const video = document.getElementById('cameraStream');
  const imagePreview = document.getElementById('imagePreview');
  const imagePlaceholder = document.getElementById('imagePlaceholder');
  const cameraButtons = document.querySelector('.camera-buttons');
  const clearImageBtn = document.getElementById('clearImageBtn');

  imagePreview.style.display = 'none';
  imagePlaceholder.style.display = 'none';
  video.style.display = 'block';
  cameraButtons.style.display = 'flex';
  clearImageBtn.style.display = 'none'; // Hide clear button when camera is active
  
  // Clear any previous solution
  solutionBox.style.display = 'none';

  try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); // Prefer back camera
      video.srcObject = mediaStream;
      video.play();
      document.getElementById('imagePreviewContainer').style.display = 'block';
      // Don't disable all buttons - just manage camera-specific buttons
      // Keep file upload disabled
      document.querySelector('.image-input-controls button:nth-of-type(2)').disabled = true; // Disable file upload button
  } catch (err) {
      console.error("Error accessing camera: ", err);
      // Display camera error message in the solution box
      solutionBox.innerHTML = `<div class="limit-message-box">Could not access camera. Please ensure permissions are granted and no other app is using the camera. Error: ${err.message}</div>`;
      solutionBox.style.display = 'block';

      video.style.display = 'none';
      cameraButtons.style.display = 'none';
      imagePlaceholder.style.display = 'block';
      document.getElementById('imagePreviewContainer').style.display = 'block'; // Keep container visible to show placeholder
      setButtonsDisabled(false); // Re-enable other buttons
      // Re-enable file upload
      document.querySelector('.image-input-controls button:nth-of-type(2)').disabled = false;
  }
}

function captureImage() {
  const video = document.getElementById('cameraStream');
  const canvas = document.getElementById('cameraCanvas');
  const imagePreview = document.getElementById('imagePreview');
  const imagePlaceholder = document.getElementById('imagePlaceholder');
  const cameraButtons = document.querySelector('.camera-buttons');
  const clearImageBtn = document.getElementById('clearImageBtn');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Stop camera stream
  if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
  }
  video.style.display = 'none';
  cameraButtons.style.display = 'none';

  
  canvas.toBlob(async (blob) => {
    try {
      const resizedBlob = await resizeImage(blob, 1024); 
      selectedImageFile = resizedBlob;
      imagePreview.src = URL.createObjectURL(selectedImageFile);
      imagePreview.style.display = 'block';
      imagePlaceholder.style.display = 'none';
      clearImageBtn.style.display = 'block';
    
      // Re-enable file upload button
    document.querySelector('.image-input-controls button:nth-of-type(2)').disabled = false;
      
      // Re-enable camera button
      document.querySelector('.image-input-controls button:nth-of-type(1)').disabled = false;
      
      console.log('Image captured and processed successfully');
    } catch (error) {
      console.error('Error processing captured image:', error);
      alert('Error processing image. Please try again.');
    }
  }, 'image/jpeg', 0.8);
}

function cancelCamera() {
  const video = document.getElementById('cameraStream');
  const imagePlaceholder = document.getElementById('imagePlaceholder');
  const cameraButtons = document.querySelector('.camera-buttons');
  
  // Stop camera stream
  if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
  }
  
  video.style.display = 'none';
  cameraButtons.style.display = 'none';
  imagePlaceholder.style.display = 'block';
  
  // Re-enable all buttons
  setButtonsDisabled(false);
}

async function handleFileUpload(event) {
  const solutionBox = document.getElementById('past-question-solution-box');
  
  // Don't check usage limit when uploading file - only when actually solving
  // This prevents the "generating" state from being triggered

  const file = event.target.files[0];
  const imagePreview = document.getElementById('imagePreview');
  const imagePlaceholder = document.getElementById('imagePlaceholder');
  const clearImageBtn = document.getElementById('clearImageBtn');
  const imagePreviewContainer = document.getElementById('imagePreviewContainer');
  const video = document.getElementById('cameraStream');
  const cameraButtons = document.querySelector('.camera-buttons');


  if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
  }
  video.style.display = 'none';
  cameraButtons.style.display = 'none';
  document.getElementById('fileUpload').value = ''; 

  // Clear any previous solution
  solutionBox.style.display = 'none';

  if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      imagePreviewContainer.style.display = 'block';
      imagePlaceholder.style.display = 'none';

      if (file.type.startsWith('image/')) {
        // Handle image files
      const resizedBlob = await resizeImage(file, 1024);
      selectedImageFile = resizedBlob;
      imagePreview.src = URL.createObjectURL(selectedImageFile);
      imagePreview.style.display = 'block';
      } else if (file.type === 'application/pdf') {
        // Handle PDF files
        selectedImageFile = file; // Store PDF file directly
        imagePreview.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2VlZSIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+UERGIEZpbGU8L3RleHQ+PC9zdmc+';
        imagePreview.style.display = 'block';
      }
      
      clearImageBtn.style.display = 'block'; // Show clear button
      setButtonsDisabled(false); // Re-enable buttons if they were disabled
      // Disable camera button when file is uploaded
      document.querySelector('.image-input-controls button:nth-of-type(1)').disabled = true; // Camera button
  } else {
      selectedImageFile = null;
      imagePreview.src = '#';
      imagePreview.style.display = 'none';
      imagePlaceholder.style.display = 'block';
      imagePreviewContainer.style.display = 'block'; // Keep container visible
      clearImageBtn.style.display = 'none';
      solutionBox.innerHTML = `<div class="limit-message-box">Please select an image or PDF file.</div>`; // Display message directly
      solutionBox.style.display = 'block';
      // Re-enable camera button
     
      document.querySelector('.image-input-controls button:nth-of-type(1)').disabled = false;
  }
}

function clearImage() {
  selectedImageFile = null;
  document.getElementById('imagePreview').src = '#';
  document.getElementById('imagePreview').style.display = 'none';
  document.getElementById('imagePlaceholder').style.display = 'block';
  document.getElementById('clearImageBtn').style.display = 'none';
  document.getElementById('past-question-solution-box').style.display = 'none'; // Clear previous solution/message
  // Re-enable camera and file upload buttons
  document.querySelector('.image-input-controls button:nth-of-type(1)').disabled = false; // Camera button
  document.querySelector('.image-input-controls button:nth-of-type(2)').disabled = false; // File upload button
}

// Helper function to convert File/Blob to Base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
  });
}

// Helper function to resize image (reduces data sent to API)
function resizeImage(file, maxWidth) {
  return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (readerEvent) => {
          const image = new Image();
          image.onload = () => {
              let width = image.width;
              let height = image.height;

              if (width > maxWidth) {
                  height = height * (maxWidth / width);
                  width = maxWidth;
              }
             
              if (height > maxWidth) {
                  width = width * (maxWidth / height);
                  height = maxWidth;
              }

              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(image, 0, 0, width, height);
              canvas.toBlob((blob) => {
                  resolve(blob);
              }, file.type, 0.8); // Quality 0.8
          };
          image.src = readerEvent.target.result;
      };
      reader.onerror = (error) => reject(error);
  });
}

// Helper function to convert PDF to image (first page only)
async function convertPdfToImage(pdfFile) {
  return new Promise((resolve, reject) => {
    try {
      // For now, we'll use a simple approach - convert PDF to base64 and let the backend handle it
      // In a production environment, you'd want to use a library like PDF.js to render the first page
      const reader = new FileReader();
      reader.onload = () => {
        // For PDFs, we'll send the raw PDF data and let the AI model handle it
        // Some AI models can process PDFs directly
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(pdfFile);
    } catch (error) {
      console.error('Error converting PDF to image:', error);
      reject(error);
    }
  });
}

function showUpgradePrompt() {
    document.getElementById('upgradeModal').style.display = 'flex';
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
}

function closeUpgradeModal() {
    document.getElementById('upgradeModal').style.display = 'none';
    // Restore body scroll when modal is closed
    document.body.style.overflow = 'auto';
}

// Helper: Get user's current plan
function getUserPlan() {
    const plan = localStorage.getItem('tutorbotPlan') || 'free';
    const paidDate = parseInt(localStorage.getItem('tutorbotPaidDate') || '0', 10);
    
    if (plan === 'free' || !paidDate) return 'free';
    
    const now = Date.now();
    const oneMonth = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
    if (now - paidDate > oneMonth) {
        // Expired: reset to free
        localStorage.removeItem('tutorbotPlan');
        localStorage.removeItem('tutorbotPaidDate');
        return 'free';
    }
    
    return plan;
}

// Listen to Firestore in real-time for cross-device achievement/XP sync
function setupAchievementListeners() {
  console.log('🔧 Setting up achievement listeners...');
  
  // Always start polling as fallback
  startAchievementPolling();
  
  try {
    if (!window.auth || !auth.currentUser) {
      console.log('⚠️ No authenticated user for Firestore listeners');
      return;
    }
    if (!window.db) {
      console.log('⚠️ Firestore not initialized, relying on polling only');
      return;
    }
    
    const userId = auth.currentUser.uid;
    console.log('🔥 Setting up Firestore listeners for user:', userId);

    // Achievements collection listener: rebuild local cache on any change
    const achievementsRef = db.collection('users').doc(userId).collection('achievements');
    achievementsRef.onSnapshot((snapshot) => {
      console.log('📊 Achievements snapshot received, docs:', snapshot.size);
      const next = {};
      snapshot.forEach(doc => { next[doc.id] = doc.data(); });

      const prevJson = JSON.stringify(userAchievements || {});
      const nextJson = JSON.stringify(next || {});
      if (prevJson !== nextJson) {
        console.log('🔄 Achievements changed via Firestore');
        userAchievements = next;
        saveAchievementsToStorage();

        // If modal is open, re-render
        const modal = document.getElementById('achievementsModal');
        if (modal && modal.style.display === 'flex') {
          loadAchievementsContent();
        }

        // Show sync notification for new achievements
        const unlockedIds = Object.keys(userAchievements || {});
        if (unlockedIds.length > 0) {
          const latest = userAchievements[unlockedIds[unlockedIds.length - 1]];
          if (latest && latest.name) {
            showAchievementSyncNotification(latest);
          }
        }
      }
    }, (error) => {
      console.warn('❌ Achievements listener error:', error);
    });

    // User document listener: updates for stats and totalXP
    const userRef = db.collection('users').doc(userId);
    userRef.onSnapshot((doc) => {
      console.log('👤 User doc snapshot received, exists:', doc.exists);
      if (!doc.exists) return;
      const data = doc.data() || {};
      
      if (data.achievementStats) {
        const prevJson = JSON.stringify(achievementStats || {});
        const nextJson = JSON.stringify(data.achievementStats || {});
        if (prevJson !== nextJson) {
          console.log('📈 Achievement stats changed via Firestore');
          achievementStats = data.achievementStats;
          saveStatsToStorage();
          const modal = document.getElementById('achievementsModal');
          if (modal && modal.style.display === 'flex') {
            loadAchievementsContent();
          }
        }
      }

      if (typeof data.totalXP === 'number') {
        console.log('💎 TotalXP from Firestore:', data.totalXP);
        const localTotal = computeTotalXPFromLocal();
        if (data.totalXP >= localTotal) {
          applyBackendXPToProfile(data.totalXP);
        }
        // Force backend sync when XP changes
        loadAchievementsFromBackend();
      }
    }, (error) => {
      console.warn('❌ User doc listener error:', error);
    });

    console.log('✅ Firestore achievement listeners active');
  } catch (e) {
    console.warn('❌ setupAchievementListeners error:', e);
  }
}

// Polling fallback for cross-device sync
function startAchievementPolling() {
  // Prevent multiple intervals
  if (window.achievementPollInterval) {
    clearInterval(window.achievementPollInterval);
  }
  
  console.log('🔄 Starting achievement polling every 8 seconds');
  window.achievementPollInterval = setInterval(() => {
    console.log('📡 Polling achievements from backend...');
    loadAchievementsFromBackend();
  }, 8000); // Poll every 8 seconds
}

// Small toast to indicate a sync occurred
function showAchievementSyncNotification(achievement) {
  try {
    const notification = document.createElement('div');
    notification.className = 'achievement-notification';
    notification.style.background = 'linear-gradient(135deg, #0ea5e9 0%, #22d3ee 100%)';
    notification.innerHTML = `
      <div class="achievement-content">
        <div class="achievement-icon">${achievement.icon || '🎉'}</div>
        <div class="achievement-text">
          <div class="achievement-title">Synced from another device</div>
          <div class="achievement-name">${achievement.name || ''}</div>
        </div>
      </div>
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 50);
    setTimeout(() => { notification.classList.remove('show'); setTimeout(() => notification.remove(), 300); }, 2500);
  } catch {}
}

// Compute total XP from local stored level and in-level XP
function computeTotalXPFromLocal() {
  const level = getStoredLevel() || 1;
  const inLevelXP = getStoredXP() || 0;
  let total = 0;
  for (let l = 1; l < level; l++) {
    total += xpNeededForLevel(l);
  }
  total += inLevelXP;
  return total;
}

// Helper: Checking if user is Plus (for backward compatibility)
function isPlusUser() {
    return getUserPlan() === 'premium';
}

// Plan selection handler
function selectPlan(planType) {
    const planPrices = {
        basic: 499,    // GHS 4.99 in pesewas
        standard: 999, // GHS 9.99 in pesewas
        premium: 1499  // GHS 14.99 in pesewas
    };
    
    const planNames = {
        basic: 'Basic',
        standard: 'Standard', 
        premium: 'Premium'
    };
    
    if (!planPrices[planType]) {
        alert('Invalid plan selected');
        return;
    }
    
    // Add visual feedback
    highlightSelectedPlan(planType);
    
    // Store selected plan for payment
    localStorage.setItem('selectedPlan', planType);
    
    // Proceed with payment
    payWithPaystack(planType, planPrices[planType], planNames[planType]);
}

// Visual feedback for plan selection
function highlightSelectedPlan(planType) {
    // Remove selected class from all cards
    document.querySelectorAll('.pricing-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    // Add selected class to clicked card
    const selectedCard = document.querySelector(`[data-plan="${planType}"]`);
    if (selectedCard) {
        selectedCard.classList.add('selected');
        
        // Update button text to show selection
        const button = selectedCard.querySelector('.plan-select-btn');
        if (button) {
            const originalText = button.textContent;
            button.textContent = 'Selected ✓';
            button.style.background = '#10b981';
            
            // Reset after 2 seconds
            setTimeout(() => {
                button.textContent = originalText;
                if (planType === 'basic') button.style.background = '#6b7280';
                else if (planType === 'standard') button.style.background = '#3b82f6';
                else if (planType === 'premium') button.style.background = '#a78bfa';
            }, 2000);
        }
    }
}

// Called this after successful payment
function grantPlanAccess(planType) {
    localStorage.setItem('tutorbotPlan', planType);
    localStorage.setItem('tutorbotPaidDate', Date.now().toString());
    
    // For backward compatibility, also set Plus status if premium
    if (planType === 'premium') {
    localStorage.setItem('tutorbotPlus', 'true');
        localStorage.setItem('tutorbotPlusPaidDate', Date.now().toString());
    }
    
    closeUpgradeModal();
    
    const planNames = {
        basic: 'Basic',
        standard: 'Standard',
        premium: 'Premium'
    };
    
    document.getElementById('response').innerHTML = `<div class="limit-message-box" style="background:#10b981; color:#fff;">🎉 Upgrade successful! You now have ${planNames[planType]} plan access for 1 month.</div>`;
    document.getElementById('response').style.display = 'block';
    
    // Update limits based on plan
    const planLimits = PLAN_LIMITS[planType];
    Object.keys(DAILY_LIMITS).forEach(k => {
        if (planLimits[k]) DAILY_LIMITS[k] = planLimits[k];
    });
    
    setButtonsDisabled(false);
}

// Legacy function for backward compatibility
function grantPlusAccess() {
    grantPlanAccess('premium');
}

// Paystack payment logic
function payWithPaystack(planType = 'premium', amount = 5000, planName = 'Premium') {
    console.log('payWithPaystack called for plan:', planType, 'amount:', amount);
    console.log('auth.currentUser:', auth.currentUser);
    let email = '';
    if (window.auth && auth.currentUser && auth.currentUser.email) {
        email = auth.currentUser.email.trim();
        localStorage.setItem('tutorbotUserEmail', email);
    } else {
        email = (localStorage.getItem('tutorbotUserEmail') || '').trim();
    }
    console.log('Paystack email:', email);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        alert('No valid email found. Please sign up again.');
        return;
    }
    var handler = PaystackPop.setup({
        key: 'pk_live_1e834a58cf99e6e60271252fde08554e4515b4a4',
        email: email,
        amount: amount, 
        currency: "GHS",
        ref: 'TUTORBOT-' + planType.toUpperCase() + '-' + Math.floor((Math.random() * 1000000000) + 1),
        callback: function(response){
            grantPlanAccess(planType);
        },
        onClose: function(){
            alert('Payment window closed. Upgrade not completed.');
        }
    });
    handler.openIframe();
}

document.addEventListener('DOMContentLoaded', function() {
    const payBtn = document.getElementById('paystackUpgradeBtn');
    if (payBtn) {
        payBtn.onclick = payWithPaystack;
        payBtn.disabled = true;
    }

    if (window.auth) {
        auth.onAuthStateChanged(function(user) {
            const payBtn = document.getElementById('paystackUpgradeBtn');
            if (user && user.email) {
                localStorage.setItem('tutorbotUserEmail', user.email);
                if (payBtn) {
                    payBtn.disabled = false;
                }
            } else {
                if (payBtn) {
                    payBtn.disabled = true;
                }
            }
        });
    }

    // If plan expired, prompt renewal
    const userPlan = getUserPlan();
    if (userPlan === 'free' && (localStorage.getItem('tutorbotPaidDate'))) {
        promptRenewPlan();
    }

    // Update limits based on current plan
    const planLimits = PLAN_LIMITS[userPlan];
    Object.keys(DAILY_LIMITS).forEach(k => {
        if (planLimits[k]) DAILY_LIMITS[k] = planLimits[k];
    });
    
        setButtonsDisabled(false);
});

// Initialize speech buttons on load
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Content Loaded - TutorBot initializing...');
  
  // Test if goToScreen function is available
  if (typeof goToScreen === 'function') {
    console.log('goToScreen function is available');
  } else {
    console.error('goToScreen function is NOT available');
  }
  
  initializeDailyUsage(); // Load daily usage immediately
  updateSpeechControlButtons();
  
  // Set up Firebase listeners for real-time sync
  if (window.auth) {
    auth.onAuthStateChanged((user) => {
      if (user) {
        console.log('🔐 User authenticated, loading achievements...');
        // Clean up legacy unscoped keys (one-time migration)
        try { localStorage.removeItem('userAchievements'); } catch {}
        try { localStorage.removeItem('achievementStats'); } catch {}
        // Load user-scoped cached achievements/stats first
        loadAchievementsFromStorage();
        // Then load from backend after authentication
        loadAchievementsFromBackend();
        setupAchievementListeners();
      } else {
        console.log('🚫 User not authenticated');
        // Clear polling if user logs out
        if (window.achievementPollInterval) {
          clearInterval(window.achievementPollInterval);
          window.achievementPollInterval = null;
        }
        // Clear in-memory caches on logout
        userAchievements = {};
        achievementStats = {};
        // Optional: clean legacy keys
        try { localStorage.removeItem('userAchievements'); } catch {}
        try { localStorage.removeItem('achievementStats'); } catch {}
      }
    });
  }
  
  // Add keyboard navigation for pricing cards
  addPricingCardKeyboardSupport();
  
  // Add click outside to close modal
  addModalClickOutsideHandler();
  
  console.log('TutorBot initialization complete');
});

// Add click outside modal to close functionality
function addModalClickOutsideHandler() {
  const modal = document.getElementById('upgradeModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeUpgradeModal();
      }
    });
  }
}

// Add keyboard navigation support for pricing cards
function addPricingCardKeyboardSupport() {
  const pricingCards = document.querySelectorAll('.pricing-card');
  
  pricingCards.forEach(card => {
    // Make cards focusable
    card.setAttribute('tabindex', '0');
    
    // Add keyboard event listeners
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const planType = card.getAttribute('data-plan');
        if (planType) {
          selectPlan(planType);
        }
      }
    });
    
    // Add focus styles
    card.addEventListener('focus', () => {
      card.style.outline = '2px solid #3b82f6';
      card.style.outlineOffset = '2px';
    });
    
    card.addEventListener('blur', () => {
      card.style.outline = 'none';
    });
  });
}

function promptRenewPlan() {
  document.getElementById('upgradeModal').style.display = 'flex';
  document.getElementById('response').innerHTML = `<div class="limit-message-box">Your subscription has expired. Please renew to continue enjoying your plan benefits.</div>`;
  document.getElementById('response').style.display = 'block';
};

// Legacy function for backward compatibility
function promptRenewPlus() {
  promptRenewPlan();
};

// Added this function for testing
function resetDailyLimits() {
    localStorage.removeItem('tutorbotDailyUsage');
    initializeDailyUsage();
    console.log('Daily limits reset!');
}

// Test function for the new pricing system
function testPricingSystem() {
    console.log('=== Testing Pricing System ===');
    
    // Test plan limits
    console.log('Plan Limits:', PLAN_LIMITS);
    
    // Test current user plan
    const currentPlan = getUserPlan();
    console.log('Current User Plan:', currentPlan);
    
    // Test plan limits for current user
    const currentLimits = PLAN_LIMITS[currentPlan];
    console.log('Current User Limits:', currentLimits);
    
    // Test daily usage
    console.log('Current Daily Usage:', dailyUsage);
    
    // Test if user is premium
    console.log('Is Premium User:', isPlusUser());
    
    console.log('=== Test Complete ===');
}

// Test function for API connection
async function testAPIConnection() {
    console.log('=== Testing API Connection ===');
    
    try {
        const user = auth.currentUser;
        if (!user) {
            console.log('❌ No authenticated user');
            return;
        }
        
        const idToken = await user.getIdToken();
        console.log('✅ User authenticated');
        
        const response = await fetch(`${BACKEND_URL}/api/ai/test`, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + idToken
            }
        });
        
        console.log('Response status:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ API test successful:', data);
        } else {
            const errorText = await response.text();
            console.log('❌ API test failed:', errorText);
        }
    } catch (error) {
        console.log('❌ API test error:', error);
    }
    
    console.log('=== API Test Complete ===');
}

// ===== FEATURE SYSTEM =====

// Modal Management
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    

    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeModal(modalId);
      }
    });
  }
}


function addFeatureIconClickEffect(iconElement) {
  document.querySelectorAll('.feature-icon').forEach(icon => {
    icon.classList.remove('clicked');
  });
  
  // Add clicked class to current icon
  iconElement.classList.add('clicked');
  
  // Remove clicked class after animation
  setTimeout(() => {
    iconElement.classList.remove('clicked');
  }, 200);
}

// ===== ACHIEVEMENTS SYSTEM =====

const ACHIEVEMENTS = {
  // Beginner Achievements (Easy - 25-50 XP)
  first_question: { name: "First Steps", description: "Ask your first question", xp: 25, icon: "🌟", difficulty: "easy", target: 1, type: "questionsAsked" },
  first_flashcard: { name: "Memory Master", description: "Generate your first flashcard", xp: 25, icon: "🧠", difficulty: "easy", target: 1, type: "flashcardsGenerated" },
  first_quiz: { name: "Quiz Rookie", description: "Complete your first quiz", xp: 30, icon: "📝", difficulty: "easy", target: 1, type: "quizzesCompleted" },
  first_notes: { name: "Note Taker", description: "Generate your first notes", xp: 25, icon: "📚", difficulty: "easy", target: 1, type: "notesGenerated" },
  first_save: { name: "Collector", description: "Save your first answer", xp: 20, icon: "💾", difficulty: "easy", target: 1, type: "answersSaved" },
  early_bird: { name: "Early Bird", description: "Use TutorBot before 8 AM", xp: 30, icon: "🌅", difficulty: "easy", target: 1, type: "earlyUsage" },
  night_owl: { name: "Night Owl", description: "Use TutorBot after 10 PM", xp: 30, icon: "🦉", difficulty: "easy", target: 1, type: "lateUsage" },
  quick_learner: { name: "Quick Learner", description: "Complete 3 tasks in 5 minutes", xp: 40, icon: "⚡", difficulty: "easy", target: 1, type: "quickTasks" },
  
  // Intermediate Achievements (Medium - 75-150 XP)
  question_streak_5: { name: "Curious Mind", description: "Ask 5 questions in a day", xp: 75, icon: "🤔", difficulty: "medium", target: 5, type: "dailyQuestions" },
  quiz_master_5: { name: "Quiz Champion", description: "Complete 5 quizzes", xp: 100, icon: "🏆", difficulty: "medium", target: 5, type: "quizzesCompleted" },
  perfect_quiz: { name: "Perfect Score", description: "Get 100% on a quiz", xp: 150, icon: "💯", difficulty: "medium", target: 1, type: "perfectQuizzes" },
  flashcard_creator: { name: "Card Creator", description: "Generate 10 flashcards", xp: 100, icon: "🎴", difficulty: "medium", target: 10, type: "flashcardsGenerated" },
  note_scholar: { name: "Scholar", description: "Generate notes on 5 different topics", xp: 125, icon: "🎓", difficulty: "medium", target: 5, type: "uniqueTopics" },
  consistent_learner: { name: "Consistent Learner", description: "Use TutorBot 3 days in a row", xp: 120, icon: "📅", difficulty: "medium", target: 3, type: "consecutiveDays" },
  subject_explorer: { name: "Subject Explorer", description: "Ask questions in 5 different subjects", xp: 100, icon: "🗺️", difficulty: "medium", target: 5, type: "subjectsUsed" },
  speed_reader: { name: "Speed Reader", description: "Generate 20 notes", xp: 130, icon: "📖", difficulty: "medium", target: 20, type: "notesGenerated" },
  quiz_streak: { name: "Quiz Streak", description: "Complete 3 quizzes in a row", xp: 110, icon: "🎯", difficulty: "medium", target: 3, type: "quizStreak" },
  helper_friend: { name: "Helper Friend", description: "Save 15 answers to help others", xp: 90, icon: "🤝", difficulty: "medium", target: 15, type: "answersSaved" },
  
  // Advanced Achievements (Hard - 200-500 XP)
  question_master_50: { name: "Question Master", description: "Ask 50 questions", xp: 300, icon: "", difficulty: "hard", target: 50, type: "questionsAsked" },
  quiz_legend: { name: "Quiz Legend", description: "Complete 25 quizzes", xp: 400, icon: "", difficulty: "hard", target: 25, type: "quizzesCompleted" },
  knowledge_seeker: { name: "Knowledge Seeker", description: "Use all TutorBot features", xp: 250, icon: "", difficulty: "hard", target: 6, type: "featuresUsed" },
  streak_warrior: { name: "Streak Warrior", description: "Use TutorBot for 7 consecutive days", xp: 500, icon: "", difficulty: "hard", target: 7, type: "consecutiveDays" },
  subject_expert: { name: "Subject Expert", description: "Ask questions in all 8 subjects", xp: 350, icon: "", difficulty: "hard", target: 8, type: "subjectsUsed" },
  flashcard_master: { name: "Flashcard Master", description: "Generate 50 flashcards", xp: 400, icon: "", difficulty: "hard", target: 50, type: "flashcardsGenerated" },
  note_genius: { name: "Note Genius", description: "Generate 100 notes", xp: 450, icon: "", difficulty: "hard", target: 100, type: "notesGenerated" },
  perfect_student: { name: "Perfect Student", description: "Get perfect scores on 10 quizzes", xp: 600, icon: "", difficulty: "hard", target: 10, type: "perfectQuizzes" },
  dedication_master: { name: "Dedication Master", description: "Use TutorBot for 30 days", xp: 800, icon: "", difficulty: "hard", target: 30, type: "totalDays" },
  question_champion: { name: "Question Champion", description: "Ask 100 questions", xp: 500, icon: "", difficulty: "hard", target: 100, type: "questionsAsked" },
  study_marathon: { name: "Study Marathon", description: "Study for 5 hours in one day", xp: 350, icon: "", difficulty: "hard", target: 300, type: "dailyMinutes" },
  weekend_warrior: { name: "Weekend Warrior", description: "Use TutorBot every weekend for a month", xp: 400, icon: "", difficulty: "hard", target: 8, type: "weekendSessions" },
  achievement_hunter: { name: "Achievement Hunter", description: "Unlock 20 achievements", xp: 1000, icon: "", difficulty: "hard", target: 20, type: "achievementsUnlocked" }
};

// In-memory caches (user-scoped)
let userAchievements = {};
let achievementStats = {};

// Keys for user-scoped storage
const ACHIEVEMENTS_KEY = 'userAchievements';
const ACHIEVEMENT_STATS_KEY = 'achievementStats';

// Get a user-scoped key for achievements localStorage using Firebase UID
function getAchievementScopedKey(key) {
  const uid = (window.auth && auth.currentUser && auth.currentUser.uid) ? auth.currentUser.uid : null;
  if (!uid) return null;
  return `${uid}:${key}`;
}

function loadAchievementsFromStorage() {
  try {
    const aKey = getAchievementScopedKey(ACHIEVEMENTS_KEY);
    const sKey = getAchievementScopedKey(ACHIEVEMENT_STATS_KEY);
    if (aKey) userAchievements = JSON.parse(localStorage.getItem(aKey) || '{}'); else userAchievements = {};
    if (sKey) achievementStats = JSON.parse(localStorage.getItem(sKey) || '{}'); else achievementStats = {};
  } catch {
    userAchievements = {}; achievementStats = {};
  }
}

function saveAchievementsToStorage() {
  const aKey = getAchievementScopedKey(ACHIEVEMENTS_KEY);
  if (aKey) localStorage.setItem(aKey, JSON.stringify(userAchievements));
}

function saveStatsToStorage() {
  const sKey = getAchievementScopedKey(ACHIEVEMENT_STATS_KEY);
  if (sKey) localStorage.setItem(sKey, JSON.stringify(achievementStats));
}

function checkAchievement(achievementId) {
  if (userAchievements[achievementId]) return; // Already unlocked
  
  const achievement = ACHIEVEMENTS[achievementId];
  if (!achievement) return;
  
  const currentValue = achievementStats[achievement.type] || 0;
  const unlocked = currentValue >= achievement.target;
  
  if (unlocked) {
    unlockAchievement(achievementId);
  }
}

function getAchievementProgress(achievementId) {
  const achievement = ACHIEVEMENTS[achievementId];
  if (!achievement) return 0;
  
  const currentValue = achievementStats[achievement.type] || 0;
  return Math.min(currentValue / achievement.target, 1);
}

async function unlockAchievement(achievementId) {
  const achievement = ACHIEVEMENTS[achievementId];
  if (!achievement) return;

  // Optimistically mark as unlocked locally to prevent duplicate checks/notifications
  if (!userAchievements[achievementId]) {
    userAchievements[achievementId] = {
      unlockedAt: new Date().toISOString(),
      ...achievement
    };
    saveAchievementsToStorage();
  }

  // Sync to backend and use its response as the source of truth for XP application
  try {
    const res = await syncAchievementToBackend(achievementId, achievement);
    if (res && res.success) {
      // Only award/apply XP if this achievement was newly created server-side
      if (res.created) {
        // Apply authoritative totalXP from backend if provided; otherwise award locally
        if (typeof res.totalXP === 'number') {
          applyBackendXPToProfile(res.totalXP);
        } else {
          // Fallback: award locally
          await awardXP(achievement.xp);
        }
        showAchievementNotification(achievement);
        console.log(`🏆 Achievement Unlocked: ${achievement.name} (+${achievement.xp} XP)`);
      } else {
        // Already unlocked server-side; ensure we render with backend XP if available
        if (typeof res.totalXP === 'number') {
          const localTotal = computeTotalXPFromLocal();
          if (res.totalXP >= localTotal) {
            applyBackendXPToProfile(res.totalXP);
          }
        }
      }
    }
  } catch (e) {
    console.warn('Failed to sync unlock to backend:', e);
  }
}

function showAchievementNotification(achievement) {
  const notification = document.createElement('div');
  notification.className = 'achievement-notification';
  notification.innerHTML = `
    <div class="achievement-content">
      <div class="achievement-icon">${achievement.icon}</div>
      <div class="achievement-text">
        <div class="achievement-title">Achievement Unlocked!</div>
        <div class="achievement-name">${achievement.name}</div>
        <div class="achievement-xp">+${achievement.xp} XP</div>
      </div>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Animate in
  setTimeout(() => notification.classList.add('show'), 100);
  
  // Remove after 4 seconds
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

function updateAchievementStat(stat, increment = 1) {
  achievementStats[stat] = (achievementStats[stat] || 0) + increment;
  saveStatsToStorage();
  
  // Sync to backend
  syncAchievementStatsToBackend(stat, achievementStats[stat]);
  
  // Check all achievements after updating stats
  Object.keys(ACHIEVEMENTS).forEach(checkAchievement);
}

// Sync achievement stats to backend
async function syncAchievementStatsToBackend(statType, value) {
  try {
    const token = await getAuthToken();
    if (!token) return;
    
    await fetch(`${BACKEND_URL}/api/achievements/stats`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        statType,
        value,
        timestamp: new Date().toISOString()
      })
    });
  } catch (error) {
    console.log('Failed to sync achievement stats to backend:', error);
  }
}

// Sync unlocked achievement to backend and return server response
async function syncAchievementToBackend(achievementId, achievement) {
  try {
    const token = await getAuthToken();
    if (!token) return;
    
    const resp = await fetch(`${BACKEND_URL}/api/achievements/unlock`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        achievementId,
        achievement,
        unlockedAt: new Date().toISOString(),
        xpAwarded: achievement.xp
      })
    });
    if (resp && resp.ok) {
      return await resp.json();
    }
    return null;
  } catch (error) {
    console.log('Failed to sync achievement to backend:', error);
  }
}

// Load achievements from backend
async function loadAchievementsFromBackend() {
  try {
    const token = await getAuthToken();
    if (!token) return;
    
    const response = await fetch(`${BACKEND_URL}/api/achievements/user`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // Update local storage with backend data (do not overwrite with empty objects)
      if (data.achievements && Object.keys(data.achievements || {}).length > 0) {
        userAchievements = data.achievements;
        saveAchievementsToStorage();
      }
      
      if (data.stats && Object.keys(data.stats || {}).length > 0) {
        achievementStats = data.stats;
        saveStatsToStorage();
      }

      // Apply backend XP to local level/xp if provided
      if (typeof data.totalXP === 'number') {
        // Only apply backend XP if it is authoritative (>= local computed)
        const localTotal = computeTotalXPFromLocal();
        if (data.totalXP >= localTotal) {
          applyBackendXPToProfile(data.totalXP);
        }
      }
      
      console.log('Achievements loaded from backend');
      
      // Refresh achievements modal if it's open
      if (document.getElementById('achievementsModal').style.display === 'flex') {
        loadAchievementsContent();
      }
    }
  } catch (error) {
    console.log('Failed to load achievements from backend:', error);
  }
}

// Convert backend total XP into local level + in-level XP and update UI/storage
function applyBackendXPToProfile(totalXP) {
  let remaining = Math.max(0, Math.floor(totalXP));
  let level = 1;
  while (true) {
    const needed = xpNeededForLevel(level);
    if (remaining < needed) break;
    remaining -= needed;
    level += 1;
    // Safety cap to avoid infinite loops
    if (level > 1000) break;
  }
  setStoredLevel(level);
  setStoredXP(remaining);
  const profile = getStoredProfile() || {};
  profile.level = level;
  profile.xp = remaining;
  setStoredProfile(profile);
  renderProfileHeader(profile);
}

function openAchievements() {
  openModal('achievementsModal');
  loadAchievementsContent();
}

function loadAchievementsContent() {
  const content = document.getElementById('achievementsContent');
  // Count unlocked by treating either an unlocked doc OR progress >= 1 as unlocked for display
  let unlockedCount = 0;
  try {
    Object.keys(ACHIEVEMENTS).forEach((id) => {
      const progress = getAchievementProgress(id);
      const hasUnlockedDoc = !!(userAchievements && userAchievements[id] && (userAchievements[id].unlockedAt || Object.keys(userAchievements[id]).length > 0));
      if (hasUnlockedDoc || progress >= 1) unlockedCount++;
    });
  } catch { unlockedCount = 0; }
  const totalCount = Object.keys(ACHIEVEMENTS).length;

  
  let html = `
    <div class="achievements-header">
      <div class="progress-summary">
        <h3>Progress: ${unlockedCount}/${totalCount} Achievements</h3>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${(unlockedCount/totalCount)*100}%"></div>
        </div>
      </div>
    </div>
    
    <div class="achievements-grid">
  `;
  
  Object.entries(ACHIEVEMENTS).forEach(([id, achievement]) => {
    const progress = getAchievementProgress(id);
    const hasUnlockedDoc = !!userAchievements[id];
    // Treat as unlocked for UI if either we have the doc or progress has reached target
    const isUnlocked = hasUnlockedDoc || progress >= 1;
    const currentValueRaw = achievementStats[achievement.type] || 0;
    const currentValue = Math.min(currentValueRaw, achievement.target); // clamp display to target
    const isInProgress = progress > 0 && progress < 1;
    
    let statusClass = 'locked';

    if (isUnlocked) statusClass = 'unlocked';
    else if (isInProgress) statusClass = 'in-progress';
    
    html += `
      <div class="achievement-card ${statusClass}">
        <div class="achievement-icon">${achievement.icon}</div>
        <div class="achievement-info">
          <h4>${achievement.name}</h4>
          <p>${achievement.description}</p>
        </div>
        <div class="achievement-meta">
          <div class="difficulty-badge ${achievement.difficulty}">${achievement.difficulty}</div>
          <div class="achievement-xp">+${achievement.xp} XP</div>
          ${!isUnlocked ? `
            <div class="achievement-progress">${currentValue}/${achievement.target}</div>
            <div class="achievement-progress-bar">
              <div class="achievement-progress-fill" style="width: ${progress * 100}%"></div>
            </div>
          ` : '<div class="achievement-progress">✓ Complete</div>'}
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  content.innerHTML = html;
}

// ===== LEADERBOARD SYSTEM =====
function openLeaderboard() {
  openModal('leaderboardModal');
  document.getElementById('leaderboardContent').innerHTML = `
    <div class="leaderboard-tabs">
      <button id="lbTabGlobal" class="tab-btn active" onclick="switchLeaderboardTab('global')">🌍 Global</button>
      <button id="lbTabFriends" class="tab-btn" onclick="switchLeaderboardTab('friends')">👥 Friends</button>
    </div>
    <div id="leaderboardSection" class="leaderboard-section">
      <p>Loading leaderboard...</p>
    </div>
  `;
  switchLeaderboardTab('global');
}

function generateSampleLeaderboard() {
  const currentUser = getStoredProfile();
  const currentXP = getStoredXP();
  return `
    <div class="leaderboard-list">
      <div class="leaderboard-item top-1">
        <div class="rank">🥇</div>
        <div class="user-info">
          <div class="avatar">${renderAvatar('🎓')}</div>
          <div class="username">StudyMaster2024</div>
        </div>
        <div class="xp">15,420 XP</div>
      </div>
      <div class="leaderboard-item current-user">
        <div class="rank">#4</div>
        <div class="user-info">
          <div class="avatar">${renderAvatar(currentUser?.avatar || '👤')}</div>
          <div class="username">${currentUser?.username || 'You'}</div>
        </div>
        <div class="xp">${currentXP || 0} XP</div>
      </div>
    </div>
  `;
}

async function switchLeaderboardTab(tab) {
  try {
    const sec = document.getElementById('leaderboardSection');
    if (!sec) return;
    const tabG = document.getElementById('lbTabGlobal');
    const tabF = document.getElementById('lbTabFriends');
    if (tabG && tabF) {
      tabG.classList.toggle('active', tab === 'global');
      tabF.classList.toggle('active', tab === 'friends');
    }
    sec.innerHTML = '<p>Loading leaderboard...</p>';

    if (tab === 'global') {
      const data = await fetchGlobalLeaderboard();
      sec.innerHTML = renderLeaderboardList(data.entries, data.highlightUid);
    } else {
      const data = await fetchFriendsLeaderboard();
      sec.innerHTML = renderLeaderboardList(data.entries, data.highlightUid);
    }
  } catch (e) {
    const sec = document.getElementById('leaderboardSection');
    if (sec) sec.innerHTML = `<p style="color:#ef4444;">Failed to load leaderboard: ${e.message}</p>`;
  }
}

function getTotalXPFromProfileLike(obj) {
  // Prefer explicit totalXP, else derive from level+xp
  if (typeof obj.totalXP === 'number') return obj.totalXP;
  const level = obj.level || 1;
  let total = 0;
  for (let l = 1; l < level; l++) total += xpNeededForLevel(l);
  total += (obj.xp || 0);
  return total;
}

function renderLeaderboardList(entries, highlightUid) {
  if (!entries || entries.length === 0) {
    return '<p>No data to display.</p>';
  }
  const sorted = [...entries].sort((a,b) => (b.totalXP||0) - (a.totalXP||0));
  const safeRender = (val) => {
    try {
      if (typeof renderAvatar === 'function') return renderAvatar(val);
    } catch {}
    const s = (typeof val === 'string' ? val.trim() : '') || '👤';
    const isImg = /\.(svg|png|jpg|jpeg|gif|webp)$/i.test(s) || s.startsWith('http') || s.startsWith('data:') || s.startsWith('svg/');
    if (isImg) {
      const safeSrc = s.replace(/"/g, '&quot;');
      return `<img src="${safeSrc}" alt="avatar" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">`;
    }
    return s || '👤';
  };
  return `
    <div class="leaderboard-list">
      ${sorted.map((u, idx) => `
        <div class="leaderboard-item ${u.userId===highlightUid?'current-user':''}">
          <div class="rank">${idx+1}</div>
          <div class="user-info">
            <div class="avatar">${safeRender(u.avatar || '👤')}</div>
            <div class="username">${u.username || '(unknown)'}</div>
          </div>
          <div class="xp">${u.totalXP || 0} XP</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function fetchGlobalLeaderboard() {
  const highlightUid = auth.currentUser?.uid || null;
  // Always use backend for consistent usernames/XP
  try {
    const token = await getAuthToken();
    const res = await fetch(`${BACKEND_URL}/api/leaderboard/global`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
      const list = await res.json();
      // Expect array of { userId, username, avatar, totalXP }
      return { entries: Array.isArray(list) ? list : [], highlightUid };
    }
  } catch {}
  // Fallback: show current user only + sample top
  const p = getStoredProfile() || {};
  const me = { userId: highlightUid || 'me', username: p.username || 'You', avatar: p.avatar || '👤', totalXP: computeTotalXPFromLocal() };
  const sample = [ { userId: 'sample1', username: 'StudyMaster2024', avatar: '🎓', totalXP: 15420 } ];
  return { entries: [ ...sample, me ], highlightUid };
}

async function fetchFriendsLeaderboard() {
  const highlightUid = auth.currentUser?.uid || null;
  const entries = [];
  try {
    // Include self
    const p = getStoredProfile() || {};
    entries.push({ userId: highlightUid || 'me', username: p.username || 'You', avatar: p.avatar || '👤', totalXP: computeTotalXPFromLocal() });

    // Load friends and fetch their profiles
    const resp = await friendsApi('/list');
    if (resp.ok) {
      const data = await resp.json();
      const friends = data.friends || [];
      // Fetch profiles sequentially (friend count usually small); could be parallel if needed
      for (const f of friends) {
        const uid = f.userId;
        try {
          const r = await friendsApi(`/profile/${uid}`);
          if (r.ok) {
            const d = await r.json();
            const prof = d.profile || {};
            const username = prof.username || f.profile?.username || '(unknown)';
            const avatar = prof.avatar || f.profile?.avatar || '👤';
            const totalXP = getTotalXPFromProfileLike(prof);
            entries.push({ userId: uid, username, avatar, totalXP });
          }
        } catch {}
      }
    }
  } catch {}
  return { entries, highlightUid };
}

// ===== GAMES SYSTEM =====
function openGames() {
  openModal('gamesModal');
  document.getElementById('gamesContent').innerHTML = `
    <div class="games-header">
      <h3>🎮 Educational Games</h3>
      <p>Play games to learn and earn XP!</p>
    </div>
    <div class="games-grid">
      <div class="game-card" onclick="playGame('math_quiz')">
        <div class="game-icon">🔢</div>
        <div class="game-info">
          <h5>Math Quiz</h5>
          <p>Test your math skills</p>
          <span class="xp-reward">+50 XP</span>
        </div>
      </div>
      <div class="game-card" onclick="playGame('science_lab')">
        <div class="game-icon">🧪</div>
        <div class="game-info">
          <h5>Science Lab</h5>
          <p>Virtual experiments</p>
          <span class="xp-reward">+60 XP</span>
        </div>
      </div>
    </div>
  `;
}

function playGame(gameId) {
  alert(`Launching ${gameId}...`);
}

// ===== FRIENDS SYSTEM =====
function openFriends() {
  openModal('friendsModal');
  const content = document.getElementById('friendsContent');
  content.innerHTML = `
    <div class="friends-tabs">
      <button id="friendsTabMy" class="tab-btn active" onclick="switchFriendsTab('my')">My Friends</button>
      <button id="friendsTabAdd" class="tab-btn" onclick="switchFriendsTab('add')">Add Friends</button>
      <button id="friendsTabInbox" class="tab-btn" onclick="switchFriendsTab('inbox')">Inbox</button>
    </div>
    <div id="friendsTabContent" class="friends-tab-content"></div>
  `;
  switchFriendsTab('my');
}

async function switchFriendsTab(tab) {
  try {
    document.getElementById('friendsTabMy').classList.toggle('active', tab === 'my');
    document.getElementById('friendsTabAdd').classList.toggle('active', tab === 'add');
    document.getElementById('friendsTabInbox').classList.toggle('active', tab === 'inbox');
  } catch {}
  const container = document.getElementById('friendsTabContent');
  if (!container) return;
  if (tab === 'my') {
    await renderMyFriends(container);
  } else if (tab === 'add') {
    renderAddFriends(container);
  } else if (tab === 'inbox') {
    await renderInbox(container);
  }
}

async function friendsApi(path, options = {}) {
  const token = await getAuthToken();
  const headers = Object.assign({ 'Authorization': `Bearer ${token}` }, options.headers || {});
  const resp = await fetch(`${BACKEND_URL}/api/friends${path}`, { ...options, headers });
  return resp;
}

async function renderMyFriends(container) {
  container.innerHTML = '<p>Loading friends...</p>';
  try {
    const resp = await friendsApi('/list');
    if (!resp.ok) throw new Error('Failed to load friends');
    const data = await resp.json();
    const friends = data.friends || [];
    if (friends.length === 0) {
      container.innerHTML = '<p>No friends yet. Go to Add Friends to connect!</p>';
      return;
    }

    container.innerHTML = `
      <div class="friends-list">
        ${friends.map(f => friendListItemHtml(f)).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<p style="color:#ef4444;">${e.message}</p>`;
  }
}

function friendListItemHtml(f) {
  const username = f.profile?.username || '(unknown)';
  const avatar = f.profile?.avatar || '👤';
  const userId = f.userId;
  return `
    <div class="friend-item" data-uid="${userId}" style="display:flex;align-items:center;justify-content:space-between;border:1px solid rgba(0,0,0,0.1);padding:8px;border-radius:10px;margin:6px 0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="avatar">${renderAvatar(avatar)}</div>
        <div class="name">${username}</div>
        <button class="info-btn" title="View profile" onclick="viewFriendProfile('${userId}')">ℹ️</button>
      </div>
      <div class="actions" style="display:flex;gap:8px;">
        <button title="Message" onclick="openMessageThread('${userId}', '${username}')">💬</button>
        <button title="Remove" onclick="removeFriend('${userId}')">🗑️</button>
        <button title="Challenge" onclick="openChallenge('${userId}', '${username}')">⚔️</button>
      </div>
    </div>
  `;
}

function renderAddFriends(container) {
  container.innerHTML = `
    <div class="friend-search" style="display:flex;gap:8px;">
      <input type="text" id="friendSearch" placeholder="Enter username (lowercase, numbers)">
      <button onclick="searchFriend()">Search</button>
    </div>
    <div id="friendSearchResult" style="margin-top:10px;"></div>
  `;
}

async function renderInbox(container) {
  container.innerHTML = '<p>Loading requests...</p>';
  try {
    const resp = await friendsApi('/requests');
    if (!resp.ok) throw new Error('Failed to load requests');
    const data = await resp.json();
    const requests = data.requests || [];
    if (requests.length === 0) {
      container.innerHTML = '<p>No friend requests.</p>';
      return;
    }
    container.innerHTML = `
      <div class="requests-list">
        ${requests.map(r => `
          <div class="request-item" style="display:flex;align-items:center;justify-content:space-between;border:1px solid rgba(0,0,0,0.1);padding:8px;border-radius:10px;margin:6px 0;">
            <div>Request from <strong>${r.fromUsername || r.fromUid}</strong></div>
            <div style="display:flex;gap:8px;">
              <button onclick="acceptFriend('${r.id}')">Accept</button>
              <button onclick="rejectFriend('${r.id}')">Reject</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<p style="color:#ef4444;">${e.message}</p>`;
  }
}

async function searchFriend() {
  const input = document.getElementById('friendSearch');
  const resultBox = document.getElementById('friendSearchResult');
  const username = (input?.value || '').trim().toLowerCase();
  if (!username) { if (resultBox) resultBox.innerHTML = '<p>Please enter a username.</p>'; return; }
  if (resultBox) resultBox.innerHTML = '<p>Searching...</p>';
  try {
    const resp = await friendsApi(`/search?username=${encodeURIComponent(username)}`);
    if (!resp.ok) {
      const err = await resp.json().catch(()=>({ error: 'User not found' }));
      if (resultBox) resultBox.innerHTML = `<p style="color:#ef4444;">${err.error || 'Search failed'}</p>`;
      return;
    }
    const data = await resp.json();
    const p = data.profile || {};
    if (data.isSelf) { if (resultBox) resultBox.innerHTML = '<p>You cannot add yourself.</p>'; return; }
    const already = !!data.alreadyFriend;
    if (resultBox) resultBox.innerHTML = `
      <div class="search-item" style="display:flex;align-items:center;justify-content:space-between;border:1px solid rgba(0,0,0,0.1);padding:8px;border-radius:10px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="avatar">${renderAvatar(p.avatar || '👤')}</div>
          <div class="name">${p.username || username}</div>
        </div>
        <div>
          ${already ? '<span>Already friends ✓</span>' : `<button onclick="sendFriendRequest('${p.username || username}')">Add Friend</button>`}
        </div>
      </div>
    `;
  } catch (e) {
    if (resultBox) resultBox.innerHTML = `<p style=\"color:#ef4444;\">${e.message}</p>`;
  }
}

async function sendFriendRequest(username) {
  try {
    const resp = await friendsApi('/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(()=>({ error: 'Failed to send request' }));
      alert(err.error || 'Failed to send request');
      return;
    }
    alert('Friend request sent!');
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}

async function acceptFriend(fromUserId) {
  try {
    const resp = await friendsApi('/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId })
    });
    if (!resp.ok) throw new Error('Failed to accept');
    await switchFriendsTab('inbox');
    await switchFriendsTab('my');
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}

async function rejectFriend(fromUserId) {
  try {
    const resp = await friendsApi('/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId })
    });
    if (!resp.ok) throw new Error('Failed to reject');
    await switchFriendsTab('inbox');
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}

async function removeFriend(friendUserId) {
  if (!confirm('Remove this friend?')) return;
  try {
    const resp = await friendsApi(`/remove/${friendUserId}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('Failed to remove');
    await switchFriendsTab('my');
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}

async function openMessageThread(withUserId, username) {
  const container = document.getElementById('friendsTabContent');
  if (!container) return;
  container.innerHTML = `<div><button onclick="switchFriendsTab('my')">← Back</button><h3>Chat with ${username}</h3><div id=\"messagesBox\" style=\"height:250px;overflow:auto;border:1px solid rgba(0,0,0,0.1);padding:8px;border-radius:8px;margin:8px 0;\">Loading...</div><div style=\"display:flex;gap:8px;\"><input type=\"text\" id=\"messageInput\" placeholder=\"Type a message...\" style=\"flex:1;\"><button id=\"sendMsgBtn\">Send</button></div></div>`;
  await loadMessages(withUserId);
  const sendBtn = document.getElementById('sendMsgBtn');
  if (sendBtn) sendBtn.onclick = async () => {
    const text = document.getElementById('messageInput').value.trim();
    if (!text) return;
    try {
      const resp = await friendsApi(`/messages/${withUserId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (resp.ok) {
        document.getElementById('messageInput').value = '';
        await loadMessages(withUserId);
      } else {
        alert('Failed to send message');
      }
    } catch (e) {
      alert('Failed to send message: ' + e.message);
    }
  };
}

async function loadMessages(withUserId) {
  try {
    const box = document.getElementById('messagesBox');
    const resp = await friendsApi(`/messages/${withUserId}?limit=100`);
    if (!resp.ok) throw new Error('Failed to load messages');
    const data = await resp.json();
    const msgs = data.messages || [];
    const myId = auth.currentUser?.uid;
    if (box) box.innerHTML = msgs.map(m => `<div style=\"margin:4px 0;${m.from===myId?'text-align:right;':''}\"><span style=\"display:inline-block;background:${m.from===myId?'#e0ffe8':'#f1f5f9'};padding:6px 8px;border-radius:8px;\">${(m.text||'').replace(/</g,'&lt;')}</span></div>`).join('');
    if (box) box.scrollTop = box.scrollHeight;
  } catch (e) {
    const box = document.getElementById('messagesBox');
    if (box) box.innerHTML = `<p style=\"color:#ef4444;\">${e.message}</p>`;
  }
}

async function openChallenge(toUserId, username) {
  const subject = prompt(`Challenge ${username} on which subject?`);
  if (!subject) return;
  try {
    const resp = await friendsApi('/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toUserId, subject })
    });
    if (!resp.ok) throw new Error('Failed to send challenge');
    alert('Challenge sent! If accepted, you will be redirected to the challenge screen.');
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}

// ===== SETTINGS SYSTEM =====
function openSettings() {
  try {
    console.log('[Settings] openSettings called');
    openModal('settingsModal');
    renderSettingsProfile();
  } catch (e) {
    console.error('[Settings] Failed to open settings:', e);
  }
}

function renderSettingsProfile() {
  console.log('[Settings] renderSettingsProfile');
  const container = document.getElementById('settingsContent');
  if (!container) return;
  const p = getStoredProfile() || {};
  const username = p.username || '';
  const avatar = p.avatar || '👤';
  container.innerHTML = `
    <div class="settings-profile" style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:center;gap:16px;">
        <div id="settingsAvatarPreview" style="width:96px;height:96px;border-radius:16px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;overflow:hidden;" onclick="openAvatarPalette()" title="Change avatar">
          ${renderAvatar(avatar).replaceAll('24px','96px')}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div id="settingsUsernameDisplay" style="font-size:18px;font-weight:600;">${username}</div>
            <button id="settingsEditNameBtn" title="Edit username" style="padding:6px 8px;">✏️</button>
          </div>
          <div id="settingsUsernameEdit" style="display:none;align-items:center;gap:8px;">
            <input id="settingsUsernameInput" type="text" value="${username}" placeholder="new username" style="padding:8px;border:1px solid rgba(0,0,0,0.15);border-radius:8px;">
            <button id="settingsSaveNameBtn">Save</button>
            <div id="settingsUsernameAvail" style="font-size:12px;color:#6b7280;"></div>
          </div>
          <div class="settings-btn-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button id="settingsChangeAvatarBtn" onclick="console.log('[Settings] Change Avatar clicked'); openAvatarPalette()">Change Avatar</button>
            <input id="settingsAvatarFile" type="file" accept="image/*" style="display:none;" onchange="console.log('[Settings] File selected'); onSettingsAvatarFileSelected(event)">
            <button id="settingsUploadAvatarBtn" onclick="console.log('[Settings] Upload clicked'); document.getElementById('settingsAvatarFile').click()">Upload</button>
            <button id="settingsCameraBtn" onclick="console.log('[Settings] Camera clicked'); openAvatarCameraDialog()">Camera</button>
            <button id="settingsSaveAvatarBtn" onclick="console.log('[Settings] Save Avatar clicked'); saveSettingsAvatar()" style="background:#2563eb;color:#fff;">Save Avatar</button>
          </div>
        </div>
      </div>

      <div style="margin-top:4px;">
        <button id="settingsLogoutBtn" onclick="logoutToSignup()" style="background:#ef4444;color:#fff;padding:10px 14px;border:none;border-radius:8px;">Log out</button>
      </div>
    </div>
  `;

  // Wire events (guard missing helpers to avoid ReferenceError)
  try {
    const editBtn = document.getElementById('settingsEditNameBtn');
    if (editBtn && typeof window.startEditSettingsUsername === 'function') {
      editBtn.onclick = window.startEditSettingsUsername;
    }
    const saveNameBtn = document.getElementById('settingsSaveNameBtn');
    if (saveNameBtn && typeof window.saveSettingsUsername === 'function') {
      saveNameBtn.onclick = window.saveSettingsUsername;
    }
    const nameInput = document.getElementById('settingsUsernameInput');
    if (nameInput && typeof window.checkUsernameAvailability === 'function') {
      nameInput.oninput = (typeof debounce === 'function') ? debounce(window.checkUsernameAvailability, 300) : window.checkUsernameAvailability;
    }
  } catch (e) { console.warn('[Settings] Username handlers not attached:', e); }

  // Lightweight guards with logs (inline handlers already set)
  console.log('[Settings] buttons wired via inline handlers');
}k

// ===== Toast Notifications =====
function showToast(message, opts = {}) {
  try {
    const {
      duration = 2200,
      type = 'info', // 'info' | 'success' | 'warning' | 'error'
    } = opts || {};

    let container = document.getElementById('notificationsContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notificationsContainer';
      container.style.cssText = 'position:fixed;bottom:16px;right:16px;display:flex;flex-direction:column;gap:8px;z-index:99999;';
      document.body.appendChild(container);
    }

    const colors = {
      info: '#60a5fa',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
    };

    const toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.style.cssText = `
      background: rgba(2,6,23,0.92);
      color: #e5e7eb;
      border-left: 4px solid ${colors[type] || colors.info};
      padding: 10px 12px;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      min-width: 220px;
      max-width: 360px;
      font-size: 14px;
      line-height: 1.35;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity .18s ease, transform .18s ease;
    `;
    toast.textContent = String(message || '');

    container.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    const remove = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => {
        if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    };

    const t = setTimeout(remove, Math.max(800, duration));
    toast.addEventListener('click', () => { clearTimeout(t); remove(); });
  } catch (e) {
    try { alert(message); } catch {}
  }
}

// Robust icon resolver for exam tiles (tries multiple extensions)
function resolveExamIcon(img) {
  try {
    const name = img?.dataset?.name || '';
    const attempt = parseInt(img?.dataset?.try || '1', 10);
    const exts = ['png','jpg','jpeg','webp','svg','PNG','JPG','JPEG','WEBP','SVG'];
    if (!name) return;
    if (attempt < exts.length) {
      img.dataset.try = String(attempt + 1);
      img.src = `icons/${name}.${exts[attempt]}`;
    } else {
      // Final fallback to a known-good icon
      img.onerror = null;
      img.src = 'icons/nsmq.png';
    }
  } catch {}

}

// ===== USAGE TRACKING & LIMITS =====
const FREE_PLAN_LIMITS = {
  aiResponses: 5,
  notes: 3,
  imageSolutions: 2,
  quizzes: 2,
  flashcards: 3
};

function getTodayKey() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function getDailyUsage() {
  const today = getTodayKey();
  const stored = localStorage.getItem('dailyUsage');
  let usage = {};
  
  try {
    usage = JSON.parse(stored) || {};
  } catch {}
  
  // Reset if it's a new day
  if (!usage.date || usage.date !== today) {
    usage = {
      date: today,
      aiResponses: 0,
      notes: 0,
      imageSolutions: 0,
      quizzes: 0,
      flashcards: 0
    };
    localStorage.setItem('dailyUsage', JSON.stringify(usage));
  }
  
  return usage;
}

function incrementUsage(type) {
  const usage = getDailyUsage();
  usage[type] = (usage[type] || 0) + 1;
  localStorage.setItem('dailyUsage', JSON.stringify(usage));
  
  // Update the usage display if it exists
  updateUsageDisplay();
  
  return usage[type];
}

function checkUsageLimit(type) {
  const profile = getStoredProfile() || {};
  const plan = profile.plan || 'free';
  
  // Paid plans have no limits
  if (plan !== 'free') return { allowed: true };
  
  const usage = getDailyUsage();
  const current = usage[type] || 0;
  const limit = FREE_PLAN_LIMITS[type] || 0;
  
  return {
    allowed: current < limit,
    current: current,
    limit: limit,
    remaining: Math.max(0, limit - current)
  };
}

function showUpgradePromptForLimit(type) {
  const limit = FREE_PLAN_LIMITS[type] || 0;
  const typeNames = {
    aiResponses: 'AI responses',
    notes: 'notes generations',
    imageSolutions: 'image solutions',
    quizzes: 'quizzes',
    flashcards: 'flashcards'
  };
  
  const typeName = typeNames[type] || type;
  showToast(`Daily limit reached! Free plan: ${limit} ${typeName}/day. Upgrade for unlimited access!`, { type: 'warning', duration: 4000 });
  
  // Auto-open upgrade modal after a short delay
  setTimeout(() => {
    showUpgradePrompt();
  }, 1500);
}

function checkPremiumFeature(feature) {
  const profile = getStoredProfile() || {};
  const plan = profile.plan || 'free';
  
  if (plan === 'free') {
    const featureNames = {
      voice: 'Voice Input',
      speech: 'Text-to-Speech',
      pdf: 'PDF Export'
    };
    
    const featureName = featureNames[feature] || feature;
    const featureType = feature === 'pdf' ? 'advanced features' : 'voice features';
    showToast(`${featureName} is a premium feature! Upgrade to unlock ${featureType}.`, { type: 'warning', duration: 3000 });
    
    setTimeout(() => {
      showUpgradePrompt();
    }, 1500);
    return;
  }
  
  // If user has paid plan, call the original function
  if (feature === 'voice') {
    startVoiceInput();
  } else if (feature === 'speech') {
    speakAnswer();
  } else if (feature === 'pdf') {
    saveNotesAsPdf();
  }
}

// Ensure global access for inline handlers and external calls
try {
  window.openSettings = window.openSettings || openSettings;
  window.renderSettingsProfile = window.renderSettingsProfile || renderSettingsProfile;
  window.openAvatarPalette = window.openAvatarPalette || openAvatarPalette;
  window.onSettingsAvatarFileSelected = window.onSettingsAvatarFileSelected || onSettingsAvatarFileSelected;
  window.openAvatarCameraDialog = window.openAvatarCameraDialog || openAvatarCameraDialog;
  window.saveSettingsAvatar = window.saveSettingsAvatar || saveSettingsAvatar;
  window.logoutToSignup = window.logoutToSignup || logoutToSignup;
  window.showToast = window.showToast || showToast;
  window.resolveExamIcon = window.resolveExamIcon || resolveExamIcon;
  window.checkUsageLimit = window.checkUsageLimit || checkUsageLimit;
  window.incrementUsage = window.incrementUsage || incrementUsage;
  window.showUpgradePromptForLimit = window.showUpgradePromptForLimit || showUpgradePromptForLimit;
  window.checkPremiumFeature = window.checkPremiumFeature || checkPremiumFeature;
} catch {}

async function saveSettingsAvatar() {
  const prev = document.getElementById('settingsAvatarPreview');
  const current = getStoredProfile() || {};
  const newAvatar = (prev && prev.dataset && prev.dataset.src) ? prev.dataset.src : '';
  if (!newAvatar) { alert('Please choose an avatar first.'); return; }
  try {
    const token = await getAuthToken();
    const resp = await fetch(`${BACKEND_URL}/api/user-data/profile`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: current.username, avatar: newAvatar, level: getStoredLevel() || 1, xp: getStoredXP() || 0 })
    });
    if (!resp.ok) { const e = await resp.json().catch(()=>({})); throw new Error(e.error || 'Failed to save avatar'); }
    const updated = { ...current, avatar: newAvatar };
    setStoredProfile(updated);
    renderProfileHeader(updated);
    // Close settings after save
    closeModal('settingsModal');
  } catch {}
}

// ===== Avatar Palette (SVG grid) =====
const SETTINGS_SVG_ICONS = [
  'svg/activity-svgrepo-com.svg',
  'svg/alarm-plus-svgrepo-com.svg',
  'svg/alien-svgrepo-com.svg',
  'svg/bell-svgrepo-com.svg',
  'svg/chef-man-cap-svgrepo-com.svg',
  'svg/cloud-bolt-svgrepo-com.svg',
  'svg/cloud-sun-alt-svgrepo-com.svg',
  'svg/cloud-up-arrow-svgrepo-com.svg',
  'svg/hourglass-half-svgrepo-com.svg',
  'svg/icicles-svgrepo-com.svg',
  'svg/snow-alt-svgrepo-com.svg',
  'svg/turn-off-svgrepo-com.svg',
  'svg/umbrella-svgrepo-com.svg'
];

function openAvatarPalette() {
  const overlay = document.createElement('div');
  overlay.id = 'avatarPaletteOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:1000;';
  const panel = document.createElement('div');
  panel.style.cssText = 'background:#fff;border-radius:12px;max-width:720px;width:90%;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,0.2);';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
      <div style="font-weight:600;font-size:16px;">Choose an Avatar</div>
      <button id="avatarPaletteClose" style="border:none;background:#f3f4f6;padding:6px 10px;border-radius:8px;cursor:pointer;">✖</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:12px;max-height:360px;overflow:auto;">
      ${SETTINGS_SVG_ICONS.map(src => `
        <div class="avatar-pick" data-src="${src}" style="border:1px solid rgba(0,0,0,0.1);border-radius:10px;padding:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:#fafafa;">
          <img src="${src}" alt="icon" style="width:64px;height:64px;object-fit:contain;">
        </div>
      `).join('')}
    </div>
  `;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  panel.querySelectorAll('.avatar-pick').forEach(div => {
    div.addEventListener('click', () => {
      const src = div.getAttribute('data-src');
      const prev = document.getElementById('settingsAvatarPreview');
      if (prev) {
        const safe = src.replace(/"/g,'&quot;');
        prev.innerHTML = `<img src="${safe}" style="width:96px;height:96px;border-radius:16px;object-fit:cover;background:#fff;">`;
        prev.dataset.src = src;
      }
      closeAvatarPalette();
    });
  });

  const closeBtn = document.getElementById('avatarPaletteClose');
  if (closeBtn) closeBtn.onclick = closeAvatarPalette;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAvatarPalette(); });
}

function closeAvatarPalette() {
  const overlay = document.getElementById('avatarPaletteOverlay');
  if (overlay) overlay.remove();
}

// File upload -> preview for settings avatar
function onSettingsAvatarFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const url = reader.result;
    const prev = document.getElementById('settingsAvatarPreview');
    if (prev) {
      prev.innerHTML = `<img src="${String(url).replace(/"/g,'&quot;')}" style="width:96px;height:96px;border-radius:16px;object-fit:cover;">`;
      prev.dataset.src = url;
    }
  };
  reader.readAsDataURL(file);
}

// Camera dialog to capture a square selfie for settings avatar
function openAvatarCameraDialog() {
  const overlay = document.createElement('div');
  overlay.id = 'avatarCameraOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;';
  const panel = document.createElement('div');
  panel.style.cssText = 'background:#fff;border-radius:12px;width:96%;max-width:520px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,0.25);';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="font-weight:600">Take a photo</div>
      <button id="avatarCamClose" style="border:none;background:#f3f4f6;padding:6px 10px;border-radius:8px;cursor:pointer;">✖</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;align-items:center;">
      <video id="avatarCamVideo" autoplay playsinline style="width:100%;max-height:300px;background:#000;border-radius:10px;"></video>
      <canvas id="avatarCamCanvas" width="256" height="256" style="display:none;"></canvas>
      <div style="display:flex;gap:8px;">
        <button id="avatarCamStart">Start</button>
        <button id="avatarCamSnap">Snap</button>
        <button id="avatarCamUse" style="background:#2563eb;color:#fff;">Use Photo</button>
      </div>
    </div>
  `;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const video = panel.querySelector('#avatarCamVideo');
  const canvas = panel.querySelector('#avatarCamCanvas');
  const startBtn = panel.querySelector('#avatarCamStart');
  const snapBtn = panel.querySelector('#avatarCamSnap');
  const useBtn = panel.querySelector('#avatarCamUse');
  const closeBtn = panel.querySelector('#avatarCamClose');

  let stream;

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      video.srcObject = stream;
    } catch (e) {
      alert('Could not access camera: ' + e.message);
    }
  }
  function stop() {
    try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch {}
    video.srcObject = null;
  }
  function snap() {
    const ctx = canvas.getContext('2d');
    const w = 256, h = 256;
    canvas.width = w; canvas.height = h;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const size = Math.min(vw, vh);
    const sx = Math.floor((vw - size) / 2);
    const sy = Math.floor((vh - size) / 2);
    try { ctx.drawImage(video, sx, sy, size, size, 0, 0, w, h); } catch {}
    canvas.style.display = 'block';
  }
  function usePhoto() {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const prev = document.getElementById('settingsAvatarPreview');
      if (prev) {
        prev.innerHTML = `<img src="${dataUrl}" style="width:96px;height:96px;border-radius:16px;object-fit:cover;">`;
        prev.dataset.src = dataUrl;
      }
      close();
    } catch (e) {
      alert('Failed to capture: ' + e.message);
    }
  }
  function close() {
    stop();
    const ov = document.getElementById('avatarCameraOverlay');
    if (ov) ov.remove();
  }

  startBtn.onclick = start;
  snapBtn.onclick = snap;
  useBtn.onclick = usePhoto;
  closeBtn.onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}
// Utility: simple debounce (used by username availability checker)
function debounce(fn, wait) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

// ===== HELP SYSTEM =====
function openHelp() {
  openModal('helpModal');
  document.getElementById('helpContent').innerHTML = `
    <div class="help-sections">
      <div class="faq-section">
        <h3>Frequently Asked Questions</h3>
        <div class="faq-item">
          <h4>How do I earn XP?</h4>
          <p>Ask questions, generate flashcards, complete quizzes, and play games!</p>
        </div>
        <div class="faq-item">
          <h4>What are achievements?</h4>
          <p>Complete challenges to unlock achievements and earn bonus XP!</p>
        </div>
        <div class="faq-item">
          <h4>How does the leaderboard work?</h4>
          <p>The Global leaderboard ranks everyone by total XP. The Friends leaderboard ranks you and your friends. Your total XP comes from achievements and activities across the app.</p>
        </div>
        <div class="faq-item">
          <h4>How do levels relate to XP?</h4>
          <p>You gain XP from actions. XP accumulates toward your current level, and each level requires more XP than the previous. Your total XP is the sum of all XP you’ve earned.</p>
        </div>
        <div class="faq-item">
          <h4>Can I change my username or avatar?</h4>
          <p>Yes. Go to Settings → Profile to update your username and avatar. Usernames must be lowercase letters and numbers and must be unique.</p>
        </div>
        <div class="faq-item">
          <h4>How do I add friends?</h4>
          <p>Open Friends → Add Friends, search by their username, and send a request. When they accept, you’ll see them in My Friends and on the Friends leaderboard.</p>
        </div>
        <div class="faq-item">
          <h4>Why don’t I see my friend’s XP updating?</h4>
          <p>XP updates in real-time for most actions, but some actions may sync with a short delay. Try refreshing the Leaderboard or re-opening Friends.</p>
        </div>
        <div class="faq-item">
          <h4>How do I use voice input?</h4>
          <p>Click the microphone button on the main screen. Grant browser permission to use your microphone. Speak clearly and wait for the transcription.</p>
        </div>
        <div class="faq-item">
          <h4>How do I solve image-based questions?</h4>
          <p>Use the camera or upload a photo in the Past Question section. We’ll extract the content and generate a solution. Make sure the image is clear and readable.</p>
        </div>
        <div class="faq-item">
          <h4>Where can I find my saved answers and flashcards?</h4>
          <p>Saved items are stored in your account and can be accessed from the relevant sections. They’re also backed up on the server when you’re signed in.</p>
        </div>
        <div class="faq-item">
          <h4>What are the daily limits?</h4>
          <p>Free plans have daily limits for certain features (responses, notes, image solutions, etc.). Upgrading your plan increases or removes these limits.</p>
        </div>
        <div class="faq-item">
          <h4>How do I change the theme?</h4>
          <p>Open Settings → Theme & Appearance to switch between Light and Dark themes.</p>
        </div>
        <div class="faq-item">
          <h4>Privacy: what data do you store?</h4>
          <p>We store essential profile data (username, avatar) and learning data (XP, achievements, saved items) to provide a consistent experience across devices.</p>
        </div>
        <div class="faq-item">
          <h4>How do I report an issue or give feedback?</h4>
          <p>Use the Feedback/Support option (if available) or contact us via the website. Include details and screenshots to help us investigate.</p>
        </div>
        <div class="faq-item">
          <h4>Why is my email verification required?</h4>
          <p>Email verification protects your account and helps us keep your data safe. If you didn’t receive a code, check spam or request another.</p>
        </div>
      </div>
    </div>
  `;
}