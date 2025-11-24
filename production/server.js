require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
const CREOLECENTRIC_API_KEY = process.env.CREOLECENTRIC_API_KEY;
const CREOLECENTRIC_USER_ID = process.env.CREOLECENTRIC_USER_ID;
const CREOLECENTRIC_BASE_URL = 'https://api.creolecentric.com/v1';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- 1. TRANSLATE ENDPOINT ---
app.post('/api/translate', async (req, res) => {
    const { text, sourceLang, targetLang } = req.body;
    
    // Simple mapping for Google Translate
    const langMap = { 'English': 'en', 'Spanish': 'es', 'Creole': 'ht' };
    const source = langMap[sourceLang];
    const target = langMap[targetLang];

    try {
        // Using free Google Translate API link (for demo purposes)
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        const data = await response.json();
        
        // Google returns [[["Translated Text",...]]]
        if (data && data[0] && data[0][0] && data[0][0][0]) {
            res.json({ translation: data[0][0][0] });
        } else {
            throw new Error('Invalid response structure from translation API');
        }
    } catch (error) {
        console.error('Translation error:', error);
        res.status(500).json({ error: 'Translation failed' });
    }
});

// --- 2. CREOLE TTS SUBMIT ENDPOINT ---
app.post('/api/submit-tts', async (req, res) => {
    const { text, voice_id } = req.body;
    try {
        const body = {
            text: text,
            voice_id: voice_id || "dagobert_conversation" // Default voice
        };

        const response = await fetch(`${CREOLECENTRIC_BASE_URL}/speak`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CREOLECENTRIC_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error(await response.text());
        
        const data = await response.json();
        res.json({ success: true, jobId: data.uuid || data.job_id }); // Adjust based on actual API response
    } catch (error) {
        console.error('TTS Submit Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- 3. CREOLE STATUS CHECK ENDPOINT ---
app.get('/api/check-status', async (req, res) => {
    const { jobId } = req.query;
    try {
        const response = await fetch(`${CREOLECENTRIC_BASE_URL}/speak/${jobId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${CREOLECENTRIC_API_KEY}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) throw new Error(await response.text());

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Status Check Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- 4. GET VOICES ENDPOINT (NEW) ---
app.get('/api/voices', async (req, res) => {
    try {
        const response = await fetch(`${CREOLECENTRIC_BASE_URL}/voices`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${CREOLECENTRIC_API_KEY}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const data = await response.json();
        res.json(data); 
    } catch (error) {
        console.error('Error fetching voices:', error);
        res.json({ voices: [] });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});