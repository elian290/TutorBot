
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
  const responseBox = document.getElementById('response');

  if (!checkUsage('responses', DAILY_LIMITS.responses, 'TutorBot responses', responseBox)) {
      return;
  }

  const subject = document.getElementById('subject').value;
  const question = document.getElementById('question').value.trim();


  if (!question) {


  if (!question) {
      responseBox.innerText = "Please enter your question in the 'Your Question' box.";
      return;
  }

  let promptText = `As a smart SHS AI Assistant for Ghanaian students specializing in ${subject}, explain the following concept or answer the question to a Senior High School student. Ensure the language is clear, concise, and aligned with WAEC standards, using relevant Ghanaian or West African examples where appropriate:\n\n"${question}".`;

  if (document.getElementById('simplify').checked) {
      promptText += ` After your detailed explanation, provide a simpler, more concise explanation for easier understanding, clearly labeled "Simplified Version:".`;
  }

  
  const promptParts = [{ text: promptText }];
  const answer = await callGeminiAPI(promptParts, responseBox, "Thinking deeply for your answer...");
  if (answer) {
      let cleanAnswer = answer.replace(/\*/g, ''); 
      responseBox.innerText = cleanAnswer;
      updateSpeechControlButtons(); 
      updateUsage('responses'); 
      awardXP(50);
  }
}
}
async function generateFlashcards() {
  const flashcardBox = document.getElementById('flashcard-box');

  // Check daily usage limit for flashcards
  if (!checkUsage('flashcards', PLAN_LIMITS[getUserPlan()].flashcards, 'flashcard generations', flashcardBox)) {
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
      updateUsage('flashcards');
      awardXP(20);
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
  // Check daily usage limit
  if (!checkUsage('notesGenerated', DAILY_LIMITS.notesGenerated, 'notes generations', notesBox)) {
      document.getElementById('saveNotesPdfBtn').style.display = 'none'; // Hide PDF button if limit reached
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
      updateUsage('notesGenerated'); // Increment usage count on successful generation
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
  
  // Check daily usage limit
  if (!checkUsage('imageSolutions', PLAN_LIMITS[getUserPlan()].imageSolutions, 'image solutions', solutionBox)) {
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
      updateUsage('imageSolutions'); 
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


  if (isNextQuiz) {
      if (!checkUsage('nextQuiz', DAILY_LIMITS.nextQuiz, '"Next Quiz" clicks', quizBox)) {
          quizControlButtons.style.display = 'none'; // Hide controls if limit reached
          return;
      }
  } else if (!checkUsage('refreshQuiz', DAILY_LIMITS.refreshQuiz, '"Daily Quiz" generations', quizBox)) {
      
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
      if (isNextQuiz) {
          updateUsage('nextQuiz');
      } else {
          updateUsage('refreshQuiz');
      }
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