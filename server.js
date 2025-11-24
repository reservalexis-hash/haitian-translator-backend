const express = require('express');
const fetch = require('node-fetch'); // Used for making HTTP requests to the external API
const cors = require('cors');

const app = express();
const PORT = 3000;

// --- CONFIGURATION: prefer environment variables for secrets ---
// Set CREOLECENTRIC_API_KEY in a .env file or your environment for safety
// Example .env content:
// CREOLECENTRIC_API_KEY=cc_xxx_your_key_here
// CREOLECENTRIC_USER_ID=you@example.com
require('dotenv').config();
const CREOLECENTRIC_API_KEY = process.env.CREOLECENTRIC_API_KEY || 'cc_jEY82gsO-77X0iflC-t4O6AUxf-I5ldqoWj_OUYElCjfxHFPvEEp-jq935CYjmTLLll0x-BFPCZyl21VHrH54J-exyrZ3QCw33hZdW8';
const CREOLECENTRIC_USER_ID = process.env.CREOLECENTRIC_USER_ID || "reservalexis@gmail.com";
// Note: Translation uses the public Google Translate endpoint and requires no key.
// -------------------------------------------------

const CREOLECENTRIC_BASE_URL = 'https://api.creolecentric.com/v1';

// Global State to manage the single TTS job (since the Node.js server is single-threaded)
let currentJobId = null;
let currentJobStatus = null; // 'submitted', 'processing', 'delivered', 'failed'
let currentAudioUrl = null;

// Middleware
app.use(cors()); 
app.use(express.json()); // To parse JSON request bodies

// =========================================================================
// 0. Translation Endpoint (Uses Public Google Translate API - NO KEY REQUIRED)
// =========================================================================
app.post('/api/translate', async (req, res) => {
    const { text, sourceLang, targetLang } = req.body;

    if (!text || !sourceLang || !targetLang) {
        return res.status(400).json({ success: false, error: 'Missing text or language parameters.' });
    }
    
    // Convert human-readable language names to Google Translate codes
    const langCodeMap = {
        'English': 'en',
        'Spanish': 'es',
        'Creole': 'ht' // Haitian Creole
    };

    const sourceCode = langCodeMap[sourceLang] || sourceLang.toLowerCase();
    const targetCode = langCodeMap[targetLang] || targetLang.toLowerCase();


    try {
        // Public Google Translate API endpoint (no key required for basic translation)
        const TRANSLATE_URL = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceCode}&tl=${targetCode}&dt=t&q=${encodeURIComponent(text)}`;
        
        const response = await fetch(TRANSLATE_URL, {
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0' } // Sometimes required to prevent block
        });

        if (!response.ok) {
            console.error('GOOGLE TRANSLATE API ERROR:', response.status);
            return res.status(500).json({ success: false, error: `Google Translate API call failed with status ${response.status}.` });
        }
        
        const result = await response.json();
        // Google Translate returns an array of translated segments in result[0].
        // Each segment is an array whose first element is the translated text.
        // Join all segments to produce the full translated text (handles multi-sentence input).
        let translatedText = '';
        try {
            console.log('Google Translate API response structure:', JSON.stringify(result).substring(0, 300)); // Log first 300 chars
            if (Array.isArray(result) && Array.isArray(result[0])) {
                // Filter out the non-translation metadata entries and join all translated segments
                translatedText = result[0]
                    .filter(seg => Array.isArray(seg) && seg.length > 0)
                    .map(seg => seg[0])
                    .join('');
            } else {
                translatedText = (result && result[0] && result[0][0]) ? result[0][0][0] : '';
            }
        } catch (e) {
            console.error('Error parsing translate response:', e);
            translatedText = '';
        }

        if (!translatedText) translatedText = "Translation Error: Could not retrieve text.";
        
        console.log('Final translated text:', translatedText.substring(0, 100)); // Log translation for debug

        res.json({ success: true, translation: translatedText });

    } catch (error) {
        console.error('SERVER CATCH ERROR during translation:', error.message);
        res.status(500).json({ success: false, error: `Internal server error during translation: ${error.message}` });
    }
});


// --- 1. TTS Job Submission Endpoint (CreoleCentric) ---
// Receives text from the HTML, submits it to the external API, and returns the job ID.
app.post('/api/submit-tts', async (req, res) => {
    const { text, voice_id: requestedVoiceId, model_id: requestedModelId } = req.body;
    
    if (!text) {
        return res.status(400).json({ success: false, error: 'Text is required.' });
    }

    if (CREOLECENTRIC_API_KEY === "DEV_KEY_123" || CREOLECENTRIC_USER_ID === "dev") {
        // Since we know the placeholders are still in the code, we stop here 
        // to force the user to replace them with their actual credentials.
        console.error('CONFIGURATION ERROR: CreoleCentric API Key or User ID is still set to placeholder value.');
        return res.status(500).json({ success: false, error: 'Configuration Error: Please replace the DEV_KEY_123 and dev placeholders in server.js with your actual credentials.' });
    }
    
    try {
        // Reset state for new job
        currentJobId = null;
        currentJobStatus = 'submitted';
        currentAudioUrl = null;

        console.log(`Submitting TTS job for text: "${text.substring(0, 50)}..."`);

        // Per CreoleCentric examples, create TTS job via POST /tts/jobs/
        // We'll pick a voice and model automatically by querying the API first.
    try {
            // 1) Get available voices
            const voicesRes = await fetch(`${CREOLECENTRIC_BASE_URL}/tts/voices/`, {
                method: 'GET',
                headers: { 'Authorization': `ApiKey ${CREOLECENTRIC_API_KEY}` }
            });
            const voicesData = voicesRes.ok ? await voicesRes.json() : null;
            console.log('Voices response status:', voicesRes.status);
            console.log('Voices response body:', voicesData);

            // 2) Get available models
            const modelsRes = await fetch(`${CREOLECENTRIC_BASE_URL}/tts/models/`, {
                method: 'GET',
                headers: { 'Authorization': `ApiKey ${CREOLECENTRIC_API_KEY}` }
            });
            const modelsData = modelsRes.ok ? await modelsRes.json() : null;
            console.log('Models response status:', modelsRes.status);
            console.log('Models response body:', modelsData);

            // Choose voice/model: prefer requested values from client when provided
            let voiceId = requestedVoiceId || null;
            let modelId = requestedModelId || null;

            // If client didn't request a voice, pick a reasonable default from API response
            if (!voiceId && voicesData && Array.isArray(voicesData.voices)) {
                const valid = voicesData.voices.find(v => v.voice_id && !v.voice_id.startsWith('voice_'));
                voiceId = valid ? valid.voice_id : voicesData.voices[0]?.voice_id;
            }
            if (!modelId && modelsData && Array.isArray(modelsData.models)) {
                modelId = modelsData.models[0]?.id;
            }

            // Fallback defaults if not found
            voiceId = voiceId || 'voice_1';
            modelId = modelId || 'model_1';

            const jobRequest = {
                text: text,
                voice_id: voiceId,
                model_id: modelId
            };

            console.log('Submitting job with body:', jobRequest);

            const jobRes = await fetch(`${CREOLECENTRIC_BASE_URL}/tts/jobs/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `ApiKey ${CREOLECENTRIC_API_KEY}`
                },
                body: JSON.stringify(jobRequest)
            });

            const jobText = await jobRes.text();
            let jobData = null;
            try { jobData = jobText ? JSON.parse(jobText) : null; } catch (e) { jobData = jobText; }

            console.log('Job submission status:', jobRes.status);
            console.log('Job submission body:', jobData);

            if (!jobRes.ok) {
                currentJobStatus = 'failed';
                return res.status(jobRes.status).json({ success: false, error: `API Submission Failed: HTTP Status ${jobRes.status}`, details: jobData });
            }

            if (jobData && jobData.id) {
                currentJobId = jobData.id;
                currentJobStatus = jobData.status || 'processing';
                console.log(`Job submitted successfully. ID: ${currentJobId}`);
                return res.json({ success: true, jobId: currentJobId });
            } else {
                currentJobStatus = 'failed';
                return res.status(500).json({ success: false, error: 'API response missing job id', details: jobData });
            }
        } catch (err) {
            console.error('SERVER CATCH ERROR during job submission (detailed):', err);
            currentJobStatus = 'failed';
            return res.status(500).json({ success: false, error: 'Internal server error during job submission.', details: err.message });
        }

    } catch (error) {
        console.error('SERVER CATCH ERROR during job submission:', error.message);
        currentJobStatus = 'failed';
        res.status(500).json({ success: false, error: 'Internal server error during job submission.' });
    }
});

// --- New: List available Creole TTS voices and models ---
app.get('/api/voices', async (req, res) => {
    try {
        const voicesRes = await fetch(`${CREOLECENTRIC_BASE_URL}/tts/voices/`, {
            method: 'GET',
            headers: { 'Authorization': `ApiKey ${CREOLECENTRIC_API_KEY}` }
        });
        const voicesData = voicesRes.ok ? await voicesRes.json() : null;

        const modelsRes = await fetch(`${CREOLECENTRIC_BASE_URL}/tts/models/`, {
            method: 'GET',
            headers: { 'Authorization': `ApiKey ${CREOLECENTRIC_API_KEY}` }
        });
        const modelsData = modelsRes.ok ? await modelsRes.json() : null;

        res.json({ success: true, voices: voicesData, models: modelsData });
    } catch (err) {
        console.error('Error fetching voices/models:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch voices/models', details: err.message });
    }
});


// --- 2. TTS Status Polling Endpoint (CreoleCentric) ---
// Called repeatedly by the HTML to check the status of the job using the job ID.
app.get('/api/check-status', async (req, res) => {
    
    if (!currentJobId || !currentJobStatus) {
        return res.json({ status: 'idle', jobId: null });
    }

    if (currentJobStatus === 'delivered' || currentJobStatus === 'failed') {
        // If already delivered or failed, return the final state immediately
        return res.json({ 
            status: currentJobStatus, 
            jobId: currentJobId, 
            audio_url: currentAudioUrl 
        });
    }

    // Attempt to poll the CreoleCentric API for status
    try {
        // Using the correct CreoleCentric status check endpoint
        // Poll the job status using the documented endpoint
        const STATUS_CHECK_URL = `${CREOLECENTRIC_BASE_URL}/tts/jobs/${currentJobId}/status/`; 

        console.log(`Checking CreoleCentric status for job ${currentJobId} at ${STATUS_CHECK_URL}`);

        const response = await fetch(STATUS_CHECK_URL, {
            method: 'GET',
            headers: {
                'Authorization': `ApiKey ${CREOLECENTRIC_API_KEY}`
            }
        });

        const rawStatusText = await response.text();
        let statusData = null;
        try {
            statusData = rawStatusText ? JSON.parse(rawStatusText) : null;
        } catch (e) {
            statusData = rawStatusText;
        }

        console.log('Status check response status:', response.status);
        console.log('Status check response body:', statusData);

        if (!response.ok) {
            console.error(`CREOLECENTRIC API STATUS CHECK ERROR (Job ${currentJobId}): HTTP Status ${response.status}`);
            currentJobStatus = 'failed';
            // Return a non-error JSON so client can handle it
            return res.json({ status: 'failed', jobId: currentJobId, error: `API Check Failed: HTTP Status ${response.status}`, details: statusData });
        }

        const data = statusData;
        
        // Update global state based on the external API's response
        currentJobStatus = data.status;

        if (data.status === 'delivered') {
            // CreoleCentric may return audio_file_url or audio_url
            currentAudioUrl = data.audio_file_url || data.audio_url || null; 
            console.log(`Job ${currentJobId} delivered. Audio URL received: ${currentAudioUrl}`);
        }

        console.log(`Job ${currentJobId} status: ${currentJobStatus}`);

        // Send the updated status back to the client
        res.json({ 
            status: currentJobStatus, 
            jobId: currentJobId, 
            audio_url: currentAudioUrl 
        });

    } catch (error) {
        console.error('SERVER CATCH ERROR during status check:', error.message);
        currentJobStatus = 'failed';
        res.json({ status: 'failed', jobId: currentJobId, error: 'Internal server error during status check.' });
    }
});


// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`SERVER STATUS: READY`);
    console.log(`Node.js server running on http://0.0.0.0:${PORT} (accessible on LAN via your PC IP)`);
    console.log("------------------------------------------------------------------------------------------------------------------------");
    console.log("!!! IMPORTANT: You MUST replace the API_KEY and USER_ID (DEV_KEY_123 and dev) placeholders above for the Creole TTS to work. !!!");
    console.log("!!! NOTE: Translation now uses the public Google Translate API (no key required!).                                      !!!");
    console.log("------------------------------------------------------------------------------------------------------------------------");
});
