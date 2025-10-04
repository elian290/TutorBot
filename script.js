
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
    try {
        // Ensure usage object is initialized and date is current
        if (!dailyUsage || !dailyUsage.lastResetDate || dailyUsage.lastResetDate !== getTodayDateString()) {
            initializeDailyUsage();
        }

        if (typeof dailyUsage[feature] !== 'number') {
            dailyUsage[feature] = 0;
        }

        dailyUsage[feature] += 1;
        localStorage.setItem('tutorbotDailyUsage', JSON.stringify(dailyUsage));
        console.log('Daily usage updated:', feature, dailyUsage[feature]);
    } catch (e) {
        console.warn('Failed to update usage for feature', feature, e);
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
// Guest mode: allow chatbot access without signup
function enterGuestMode() {
  try {
    localStorage.setItem('guestMode', '1');

    // Keep profile header hidden (no username/xp shown)
    const ph = document.getElementById('profileHeader');
    if (ph) ph.style.display = 'none';

    // Install click guard: only allow Ask TutorBot for guests
    const screen = document.getElementById('chatbotScreen');
    if (screen && !screen.__guestGuardInstalled) {
      screen.addEventListener('click', function(e) {
        try {
          const clickable = e.target.closest('button, .feature-icon, .exam-tile');
          if (!clickable) return;
          const allowedIds = new Set(['askTutorBotBtn']);
          const id = clickable.id || '';
          if (!allowedIds.has(id)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (typeof showToast === 'function') {
              showToast('Sign up to access more features.');
            } else {
              alert('Sign up to access more features.');
            }
          }
        } catch (_) {}
      }, true);
      screen.__guestGuardInstalled = true;
    }

    // Go to course selection first
    goToScreen('courseScreen');

    // Notify
    if (typeof showToast === 'function') showToast('Guest mode: select your course to begin.');
  } catch (e) {
    console.error('Failed to enter guest mode:', e);
    goToScreen('courseScreen');
  }
}

// Expose for inline use
try { window.enterGuestMode = window.enterGuestMode || enterGuestMode; } catch {}
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
  // In guest mode, never render the profile header
  try { if (localStorage.getItem('guestMode') === '1') { if (header) header.style.display = 'none'; return; } } catch {}
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
  // Skip XP accrual in guest mode
  try { if (localStorage.getItem('guestMode') === '1') { return; } } catch {}
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
      // Clear guest flag on real login
      try { localStorage.removeItem('guestMode'); } catch {}
      
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
  
  // If in guest mode, skip profile setup and go straight to chatbot
  try {
    if (localStorage.getItem('guestMode') === '1') {
      const header = document.getElementById('profileHeader');
      if (header) header.style.display = 'none';
      goToScreen('chatbotScreen');
      if (typeof showToast === 'function') showToast('Guest mode: you can now ask TutorBot.');
      return;
    }
  } catch {}
  
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

// ... rest of the code remains the same ...

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
}

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

// Ensure global access for inline handlers and external calls
try {
  if (typeof openSettings === 'function') window.openSettings = window.openSettings || openSettings;
  if (typeof renderSettingsProfile === 'function') window.renderSettingsProfile = window.renderSettingsProfile || renderSettingsProfile;
  if (typeof openAvatarPalette === 'function') window.openAvatarPalette = window.openAvatarPalette || openAvatarPalette;
  if (typeof onSettingsAvatarFileSelected === 'function') window.onSettingsAvatarFileSelected = window.onSettingsAvatarFileSelected || onSettingsAvatarFileSelected;
  if (typeof openAvatarCameraDialog === 'function') window.openAvatarCameraDialog = window.openAvatarCameraDialog || openAvatarCameraDialog;
  if (typeof saveSettingsAvatar === 'function') window.saveSettingsAvatar = window.saveSettingsAvatar || saveSettingsAvatar;
  if (typeof logoutToSignup === 'function') window.logoutToSignup = window.logoutToSignup || logoutToSignup;
  if (typeof showToast === 'function') window.showToast = window.showToast || showToast;
  if (typeof resolveExamIcon === 'function') window.resolveExamIcon = window.resolveExamIcon || resolveExamIcon;

  // Chatbot core actions (guard each to avoid ReferenceErrors)
  if (typeof getResponse === 'function') window.getResponse = window.getResponse || getResponse;
  if (typeof startVoiceInput === 'function') window.startVoiceInput = window.startVoiceInput || startVoiceInput;
  if (typeof speakAnswer === 'function') window.speakAnswer = window.speakAnswer || speakAnswer;
  if (typeof pauseSpeech === 'function') window.pauseSpeech = window.pauseSpeech || pauseSpeech;
  if (typeof resumeSpeech === 'function') window.resumeSpeech = window.resumeSpeech || resumeSpeech;
  if (typeof stopProcess === 'function') window.stopProcess = window.stopProcess || stopProcess;
  if (typeof generateNotes === 'function') window.generateNotes = window.generateNotes || generateNotes;
  if (typeof solvePastQuestion === 'function') window.solvePastQuestion = window.solvePastQuestion || solvePastQuestion;
  if (typeof generateQuiz === 'function') window.generateQuiz = window.generateQuiz || generateQuiz;
  if (typeof generateFlashcards === 'function') window.generateFlashcards = window.generateFlashcards || generateFlashcards;
  if (typeof saveHistory === 'function') window.saveHistory = window.saveHistory || saveHistory;
  if (typeof loadSavedFlashcards === 'function') window.loadSavedFlashcards = window.loadSavedFlashcards || loadSavedFlashcards;
  if (typeof navigateHistory === 'function') window.navigateHistory = window.navigateHistory || navigateHistory;
  if (typeof navigateFlashcards === 'function') window.navigateFlashcards = window.navigateFlashcards || navigateFlashcards;
  if (typeof startTutorBot === 'function') window.startTutorBot = window.startTutorBot || startTutorBot;
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