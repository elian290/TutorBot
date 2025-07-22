# TutorBot Frontend

This is the frontend for TutorBot, an AI-powered study assistant designed for Ghanaian Senior High School (SHS) students. The frontend is built with vanilla JavaScript, HTML, and CSS, and connects to a Node.js/Express backend with Firebase authentication and Paystack payment integration.

## Features

- AI-Powered Q&A: Ask TutorBot subject-specific questions and get detailed, WAEC-aligned answers.
- Daily Usage Limits: Free users have daily limits on AI responses, notes, image solutions, and quizzes. Upgrade to Plus for unlimited access.
- Speech Synthesis: Listen to answers read aloud with speech controls (play, pause, resume).
- Voice Input: Use your microphone to ask questions by voice (Chrome/Edge recommended).
- Notes Generation: Generate and download comprehensive notes as PDF on any topic.
- Flashcards: Create, save, and review flashcards for quick revision.
- WAEC Quiz Generator: Generate and take multiple-choice quizzes, with instant scoring and feedback.
- Image Input: Snap or upload images of past questions for AI-powered solutions.
- User Authentication: Sign up and log in with email and password (Firebase Auth).
- Paystack Integration: Upgrade to TutorBot Plus for unlimited access via secure Paystack payments.

## Folder Structure

- index.html - Main app interface
- script.js - Main JavaScript logic for all features
- styles.css - App styling
- src/firebase-config.js - Firebase configuration
- tutorbot icon.png - App icon

## Setup and Usage

1. Clone the repository and navigate to the Frontend folder.
2. Configure Firebase:
   - Update src/firebase-config.js with your Firebase project credentials.
3. Open index.html in your browser.
   - For full functionality (auth, payments, AI), you must run the backend server and have valid Firebase and Paystack setup.
4. Sign up or log in to use TutorBot features.
5. Upgrade to Plus via the Upgrade modal for unlimited access.

## Requirements

- Modern browser (Chrome or Edge recommended for voice input)
- Backend server running (see Backend folder)
- Firebase project (for authentication)
- Paystack account (for payments)

## Notes
- All user data (answers, flashcards) is synced with the backend and stored securely.
- Daily usage limits reset every 24 hours for free users.
- Speech and voice features may not work on all mobile browsers.

## Support
For issues or feature requests, please contact the project maintainer or open an issue in the repository. 