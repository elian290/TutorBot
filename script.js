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

let dailyUsage = {
    responses: 0,
    readAnswers: 0,
    notesGenerated: 0,
    imageSolutions: 0,
    nextQuiz: 0,
    refreshQuiz: 0,
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
    if (isPlusUser()) return true; // No limits for Plus
    if (dailyUsage[feature] >= limit) {
        const message = `You've reached your daily limit on the free plan. Upgrade to TutorBot Plus for unlimited access!`;
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



function goToScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'chatbotScreen') {
      initializeDailyUsage(); 
  }
}

// Email verification variables
let verificationEmail = '';
let verificationCode = '';

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
      // Show verification code input
      showVerificationStep();
      alert('Verification code sent to your email! Please check your inbox and spam folder.');
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
  // Find the signup form and hide it
  const signupForm = document.querySelector('.signup-form') || document.querySelector('form');
  if (signupForm) {
    signupForm.style.display = 'none';
  }
  
  // Show verification form
  const verificationHTML = `
    <div class="verification-form" style="max-width: 400px; margin: 0 auto; padding: 20px;">
      <h2>Verify Your Email</h2>
      <p>We've sent a 6-digit verification code to <strong>${verificationEmail}</strong></p>
      <input type="text" id="verificationCode" placeholder="Enter 6-digit code" maxlength="6" style="width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px;">
      <button onclick="verifyAndSignup()" class="continue-btn" style="width: 100%; padding: 10px; margin: 10px 0; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer;">Verify & Sign Up</button>
      <button onclick="goBackToSignup()" class="back-btn" style="width: 100%; padding: 10px; margin: 10px 0; background: #6b7280; color: white; border: none; border-radius: 4px; cursor: pointer;">Back to Signup</button>
    </div>
  `;
  
  // Find the current screen and add verification form
  const currentScreen = document.querySelector('.screen') || document.querySelector('.container') || document.body;
  currentScreen.innerHTML += verificationHTML;
}

function goBackToSignup() {
  // Remove verification form
  const verificationForm = document.querySelector('.verification-form');
  if (verificationForm) {
    verificationForm.remove();
  }
  
  // Show signup form
  const signupForm = document.querySelector('.signup-form') || document.querySelector('form');
  if (signupForm) {
    signupForm.style.display = 'block';
  }
  
  verificationEmail = '';
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
      const password = document.getElementById('password').value.trim();
      
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
      localStorage.setItem('tutorbotUserEmail', auth.currentUser.email); // Store email after login
      goToScreen('courseScreen');
    } catch (error) {
      document.getElementById('loginError').innerText = error.message;
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
  const course = document.getElementById('courseSelect').value;
  const subjectSelect = document.getElementById('subject');
  let subjects = [];
  if (course === 'science') {
    subjects = ['Core Maths', 'Physics', 'Chemistry', 'Biology', 'Elective Maths', 'Social Studies', 'Integrated Science', 'English Language'];
  } else if (course === 'business') {
    subjects = ['Economics', 'Financial Accounting','Business Management', 'Elective Maths', 'Core Maths', 'Integrated Science', 'English Language', 'Social Studies'];
  } else if (course === 'visualArts') {
    subjects = ['Leatherwork', 'Elective Maths', 'Sculpture','Basketry', 'Graphic Design', 'Picture Making', 'Ceramics', 'Textiles'];
  } else if (course === 'generalArts') {
    subjects = ['Elective Maths', 'Core Maths', 'Integrated Science', 'Social Studies', 'English Language', 'Geography','Government', 'History', 'Literature in English','Christian Religious Studies', 'French', 'Economics'];
  }
  subjectSelect.innerHTML = subjects.map(sub => `<option value="${sub}">${sub}</option>`).join('');
  goToScreen('chatbotScreen');
  
  // Load user data when entering chatbot screen
  await loadUserData();
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

        const response = await fetch(`${API_BASE}/api/ai/gemini`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + idToken
            },
            body: JSON.stringify({ promptParts }),
            signal: signal
        });

        if (!response.ok) {
            const errorData = await response.json();
            outputElement.innerText = `Error: ${errorData.error || 'An unknown API error occurred.'}`;
            return null;
        }

        const data = await response.json();
        if (data.text) {
            return data.text;
        } else {
            outputElement.innerText = "No content generated.";
            return null;
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            outputElement.innerText = "Generation cancelled by user.";
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
  }
}

async function generateFlashcards() {


  const question = document.getElementById('question').value.trim();
  const subject = document.getElementById('subject').value;
  const flashcardBox = document.getElementById('flashcard-box');

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
  if (!checkUsage('imageSolutions', DAILY_LIMITS.imageSolutions, 'image solutions', solutionBox)) {
      return;
  }

  const subject = document.getElementById('subject').value;


  if (!selectedImageFile) {
      solutionBox.innerText = "Please capture or upload an image of the WAEC past question first.";
      solutionBox.style.display = 'block';
      return;
  }

  // Converted image file to base64
  const base64Image = await fileToBase64(selectedImageFile);
  if (!base64Image) {
      solutionBox.innerText = "Failed to process image. Please try again with a different image.";
      return;
  }

  const promptText = `You are a highly experienced SHS teacher in Ghana specializing in ${subject}. Analyze the image provided, which contains a WAEC past question. Provide a detailed, step-by-step solution or explanation for this question. Your answer should be comprehensive, accurate, and structured in a way that matches typical WAEC mark schemes, clearly showing working or reasoning, suitable for a Ghanaian SHS student.`;

  // Multimodal prompt: array of parts including text and image
  const promptParts = [
      { text: promptText },
      {
          inlineData: {
              mimeType: selectedImageFile.type,
              data: base64Image.split(',')[1] // Get base64 data after 'data:image/jpeg;base64,'
          }
      }
  ];

  const solutionContent = await callGeminiAPI(promptParts, solutionBox, "Analyzing image and preparing detailed WAEC solution...");
  if (solutionContent) {
      solutionBox.innerHTML = `<strong>Solution for WAEC Past Question:</strong><br>${solutionContent}`;
      updateUsage('imageSolutions'); 
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
  // Check daily usage limit. This counts as one image solution attempt.
  if (!checkUsage('imageSolutions', DAILY_LIMITS.imageSolutions, 'image solutions', solutionBox)) {
      return;
  }

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

  try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); // Prefer back camera
      video.srcObject = mediaStream;
      video.play();
      document.getElementById('imagePreviewContainer').style.display = 'block';
      setButtonsDisabled(true); // Disable all buttons
      // Manually enable camera controls
      document.getElementById('captureBtn').disabled = false;
      document.getElementById('retakeBtn').disabled = false;
      document.getElementById('cancelCameraBtn').disabled = false;
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
    
      const resizedBlob = await resizeImage(blob, 1024); 
      selectedImageFile = resizedBlob;
      imagePreview.src = URL.createObjectURL(selectedImageFile);
      imagePreview.style.display = 'block';
      imagePlaceholder.style.display = 'none';
    
    document.querySelector('.image-input-controls button:nth-of-type(2)').disabled = false;
});
}

async function handleFileUpload(event) {
  const solutionBox = document.getElementById('past-question-solution-box');
  
  if (!checkUsage('imageSolutions', DAILY_LIMITS.imageSolutions, 'image solutions', solutionBox)) {
     
      document.getElementById('fileUpload').value = '';
      return;
  }

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

  if (file && file.type.startsWith('image/')) {
      imagePreviewContainer.style.display = 'block';
      imagePlaceholder.style.display = 'none';

      const resizedBlob = await resizeImage(file, 1024);
      selectedImageFile = resizedBlob;

      imagePreview.src = URL.createObjectURL(selectedImageFile);
      imagePreview.style.display = 'block';
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
      solutionBox.innerHTML = `<div class="limit-message-box">Please select an image file.</div>`; // Display message directly
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

function showUpgradePrompt() {
    document.getElementById('upgradeModal').style.display = 'flex';
}

function closeUpgradeModal() {
    document.getElementById('upgradeModal').style.display = 'none';
}

// Helper: Checking if user is Plus (stored in localStorage)
function isPlusUser() {
    const paid = localStorage.getItem('tutorbotPlus') === 'true';
    const paidDate = parseInt(localStorage.getItem('tutorbotPlusPaidDate') || '0', 10);
    if (!paid || !paidDate) return false;
    const now = Date.now();
    const oneMonth = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
    if (now - paidDate > oneMonth) {
        // Expired: remove Plus status
      localStorage.removeItem('tutorbotPlus');
      localStorage.removeItem('tutorbotPlusPaidDate');
      return false;
    }
    return true;
}

// Called this after successful payment
function grantPlusAccess() {
    localStorage.setItem('tutorbotPlus', 'true');
    localStorage.setItem('tutorbotPlusPaidDate', Date.now().toString()); // Store payment timestamp
    closeUpgradeModal();
    document.getElementById('response').innerHTML = `<div class="limit-message-box" style="background:#10b981; color:#fff;">🎉 Upgrade successful! You now have unlimited access to all features for 1 month.</div>`;
    document.getElementById('response').style.display = 'block';
    Object.keys(DAILY_LIMITS).forEach(k => DAILY_LIMITS[k] = 99999);
    setButtonsDisabled(false);
}

// Paystack payment logic
function payWithPaystack() {
    console.log('payWithPaystack called');
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
        amount: 5000, 
        currency: "GHS",
        ref: 'TUTORBOT-' + Math.floor((Math.random() * 1000000000) + 1),
        callback: function(response){
            grantPlusAccess();
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

    // If Plus expired, prompt renewal
    if (!isPlusUser() && (localStorage.getItem('tutorbotPlusPaidDate'))) {
        promptRenewPlus();
    }

    // If Plus is active, remove limits
    if (isPlusUser()) {
        Object.keys(DAILY_LIMITS).forEach(k => DAILY_LIMITS[k] = 99999);
        setButtonsDisabled(false);
    }
});

// Initialize speech buttons on load
document.addEventListener('DOMContentLoaded', () => {
  initializeDailyUsage(); // Load daily usage immediately
  updateSpeechControlButtons();
});

function promptRenewPlus() {
  document.getElementById('upgradeModal').style.display = 'flex';
  document.getElementById('response').innerHTML = `<div class="limit-message-box">Your Plus subscription has expired. Please renew to continue enjoying unlimited access.</div>`;
  document.getElementById('response').style.display = 'block';
};

// Added this function for testing
function resetDailyLimits() {
    localStorage.removeItem('tutorbotDailyUsage');
    initializeDailyUsage();
    console.log('Daily limits reset!');
}

