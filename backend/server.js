import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PDFParse: pdf } = require('pdf-parse');

import Database from 'better-sqlite3';
import multer from 'multer';
import mammoth from 'mammoth';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite database
const db = new Database(path.join(__dirname, 'library.sqlite'));
db.pragma('foreign_keys = ON');

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS saved_transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    transcript TEXT NOT NULL,
    summary TEXT NOT NULL,
    embedding TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sources TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: Check if embedding column exists (in case table was created before)
try {
    db.exec("ALTER TABLE saved_transcripts ADD COLUMN embedding TEXT");
} catch (e) { }

// Migration: Add tag_id to saved_transcripts
try {
    db.exec("ALTER TABLE saved_transcripts ADD COLUMN tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL");
} catch (e) { }

// Migration: Add cost to saved_transcripts
try {
    db.exec("ALTER TABLE saved_transcripts ADD COLUMN cost TEXT");
} catch (e) { }

// Migration: Add tag_id to documents
try {
    db.exec("ALTER TABLE documents ADD COLUMN tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL");
} catch (e) { }

const app = express();
const port = process.env.PORT || 3001;
const execPromise = promisify(exec);

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Request Logging Middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} [${req.method}] ${req.url}`);
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
        console.log('Body:', JSON.stringify(req.body, null, 2));
    }
    next();
});

app.get('/api/ping', (req, res) => res.json({ message: 'pong', timestamp: new Date().toISOString() }));

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// OpenAI/Gemini Pricing Constants (USD)
const PRICING = {
    'gpt-4o-mini': { input: 0.15 / 1000000, output: 0.60 / 1000000 },
    'whisper-1': { minute: 0.006 },
    'text-embedding-3-small': { input: 0.02 / 1000000 },
    'gemini-flash-latest': { input: 0.10 / 1000000, output: 0.40 / 1000000 } // Approximate
};

function calculateCost(model, usage) {
    if (!usage || !PRICING[model]) return 0;
    const rates = PRICING[model];
    if (rates.input && rates.output) {
        return (usage.prompt_tokens * rates.input) + (usage.completion_tokens * rates.output);
    }
    return 0;
}

app.post('/api/transcribe', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    // URL Format Validation
    const isInstagram = url.includes('instagram.com/reel/') || url.includes('instagram.com/p/');
    const isYouTube = url.includes('youtube.com/shorts/') || url.includes('youtu.be/');

    if (!isInstagram && !isYouTube) {
        return res.status(400).json({ error: '請提供有效的 Instagram Reel 或 YouTube Shorts 連結。' });
    }

    if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OpenAI API key is missing in server configuration' });
    }

    const tempId = Date.now();
    const audioPath = path.join(__dirname, `temp_audio_${tempId}.mp3`);

    try {
        console.log(`Starting extraction for: ${url} using model: ${req.body.model || 'openai'}`);

        // Step 1: Extract audio using yt-dlp with timeout
        console.log('Executing yt-dlp...');
        try {
            // Add a timeout to prevent hanging forever
            const timeoutMs = 30000; // 30 seconds
            const extractPromise = execPromise(`yt-dlp -x --audio-format mp3 -o "${audioPath}" "${url}"`);

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Audio extraction timed out')), timeoutMs)
            );

            await Promise.race([extractPromise, timeoutPromise]);
        } catch (extractError) {
            console.error('yt-dlp execution failed:', extractError);
            if (extractError.message === 'Audio extraction timed out') {
                throw new Error('音訊下載超時，請稍後再試或是檢查連結是否有效。');
            }
            throw new Error('無法下載音訊，可能是平台限制了存取，請稍後再試。');
        }

        if (!fs.existsSync(audioPath)) {
            throw new Error('Failed to extract audio file');
        }

        console.log(`Audio extracted: ${audioPath}`);

        // Step 2: Transcribe using Whisper-1 (Cheapest & Best for audio)
        console.log('Using OpenAI Whisper-1 for transcription');
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
            language: "zh",
            response_format: "verbose_json"
        });

        console.log(`Transcription complete. Duration: ${transcription.duration}s`);

        // Step 3: Summarize using selected model
        const selectedModel = req.body.model || 'openai';
        const systemPrompt = "你是一個專業的影音轉型文字助手。請將下方的逐字稿整理成：1. 核心重點（列表） 2. 摘要 3. 建議。請使用繁體中文。";
        console.log(`Using ${selectedModel} for summarization`);

        let summaryData;
        if (selectedModel === 'gemini') {
            summaryData = await generateText('gemini', transcription.text, systemPrompt);
        } else {
            summaryData = await generateText('openai', transcription.text, systemPrompt);
        }

        const gptCost = calculateCost(selectedModel === 'gemini' ? 'gemini-flash-latest' : 'gpt-4o-mini', summaryData.usage);
        const whisperCost = (transcription.duration || 0) / 60 * PRICING['whisper-1'].minute;

        res.json({
            transcript: transcription.text,
            summary: summaryData.text,
            usage: summaryData.usage,
            cost: (gptCost + whisperCost).toFixed(6)
        });
        console.log(`Response sent. Usage: ${JSON.stringify(summaryData.usage)}, Total Cost: ${gptCost + whisperCost}`);

    } catch (error) {
        console.error('Error during transcription:', error);
        res.status(500).json({ error: error.message || 'Failed to process request' });
    } finally {
        // Cleanup
        if (fs.existsSync(audioPath)) {
            try {
                fs.unlinkSync(audioPath);
            } catch (e) {
                console.error('Cleanup error:', e);
            }
        }
    }

});

app.post('/api/transcribe-long', async (req, res) => {
    // Set a very long timeout for this connection
    req.setTimeout(600000); // 10 minutes

    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const tempId = Date.now();
    const workingDir = path.join(__dirname, `temp_long_${tempId}`);
    const audioPath = path.join(workingDir, `full_audio.mp3`);

    try {
        if (!fs.existsSync(workingDir)) fs.mkdirSync(workingDir);

        console.log(`Starting LONG extraction for: ${url}`);

        // Step 1: Extract full audio
        await execPromise(`yt-dlp -x --audio-format mp3 -o "${audioPath}" "${url}"`, { timeout: 300000 });

        if (!fs.existsSync(audioPath)) throw new Error('Failed to extract audio');

        // Step 2: Split audio into 10-minute chunks
        console.log('Splitting audio into chunks...');
        const segmentTemplate = path.join(workingDir, 'chunk_%03d.mp3');
        await execPromise(`ffmpeg -i "${audioPath}" -f segment -segment_time 600 -c copy "${segmentTemplate}"`);

        const chunks = fs.readdirSync(workingDir)
            .filter(f => f.startsWith('chunk_') && f.endsWith('.mp3'))
            .sort();

        console.log(`Split into ${chunks.length} chunks. Starting transcription...`);

        // Step 3: Transcribe chunks sequentially to avoid rate limits
        let fullTranscript = '';
        let totalWhisperDuration = 0;
        for (let i = 0; i < chunks.length; i++) {
            const chunkPath = path.join(workingDir, chunks[i]);
            console.log(`Transcribing chunk ${i + 1}/${chunks.length}...`);

            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(chunkPath),
                model: "whisper-1",
                language: "zh",
                response_format: "verbose_json"
            });

            fullTranscript += `[時段 ${i * 10}:00 - ${(i + 1) * 10}:00]\n${transcription.text}\n\n`;
            totalWhisperDuration += (transcription.duration || 0);
        }

        // Step 4: Summarize the whole thing
        const selectedModel = req.body.model || 'openai';
        const systemPrompt = "你是一個專業的影音轉型文字助手。這是一段長影片的逐字稿，請將其整理成：1. 核心重點（列表） 2. 整體摘要 3. 逐段重點 4. 關鍵結論。請使用繁體中文。";

        console.log(`Summarizing long transcript with ${selectedModel}...`);
        const summaryData = await generateText(selectedModel, fullTranscript, systemPrompt);

        const gptCost = calculateCost(selectedModel === 'gemini' ? 'gemini-flash-latest' : 'gpt-4o-mini', summaryData.usage);
        const whisperCost = (totalWhisperDuration / 60) * PRICING['whisper-1'].minute;

        res.json({
            transcript: fullTranscript,
            summary: summaryData.text,
            usage: summaryData.usage,
            cost: (gptCost + whisperCost).toFixed(6)
        });
        console.log(`Response sent. Usage: ${JSON.stringify(summaryData.usage)}, Total Cost: ${gptCost + whisperCost}`);

    } catch (error) {
        console.error('Error during long transcription:', error);
        res.status(500).json({ error: error.message || 'Failed to process long video' });
    } finally {
        // Cleanup whole directory
        if (fs.existsSync(workingDir)) {
            try {
                fs.rmSync(workingDir, { recursive: true, force: true });
            } catch (e) {
                console.error('Cleanup error:', e);
            }
        }
    }
});
app.post('/api/transcribe-file', upload.single('file'), async (req, res) => {
    // Set a very long timeout
    req.setTimeout(600000); // 10 minutes

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputPath = req.file.path;
    const originalName = req.file.originalname;
    const fileType = req.file.mimetype;
    const tempId = Date.now();
    const workingDir = path.join(__dirname, `temp_file_${tempId}`);

    try {
        if (!fs.existsSync(workingDir)) fs.mkdirSync(workingDir);

        console.log(`Processing uploaded file: ${originalName} (${fileType})`);

        let audioPath = inputPath;

        // Step 1: Extract audio if it's a video file
        if (fileType.startsWith('video/')) {
            console.log('Extracting audio from video file...');
            const extractedAudioPath = path.join(workingDir, 'extracted_audio.mp3');
            await execPromise(`ffmpeg -i "${inputPath}" -vn -acodec libmp3lame -q:a 2 "${extractedAudioPath}"`);
            audioPath = extractedAudioPath;
        }

        // Step 2: Transcribe (handle large files if needed, but for simplicity we keep it single or segmented)
        let fullTranscript = '';
        let totalWhisperDuration = 0;

        if (fileSizeInMB > 24) {
            console.log(`File size ${fileSizeInMB.toFixed(2)}MB exceeds 25MB limit. Chunking...`);
            // Split audio into 10-minute chunks (similar to long video logic)
            const segmentTemplate = path.join(workingDir, 'chunk_%03d.mp3');
            await execPromise(`ffmpeg -i "${audioPath}" -f segment -segment_time 600 -c:a libmp3lame "${segmentTemplate}"`);

            const chunks = fs.readdirSync(workingDir)
                .filter(f => f.startsWith('chunk_') && f.endsWith('.mp3'))
                .sort();

            console.log(`Split into ${chunks.length} chunks. Starting transcription...`);

            for (let i = 0; i < chunks.length; i++) {
                const chunkPath = path.join(workingDir, chunks[i]);
                console.log(`Transcribing chunk ${i + 1}/${chunks.length}...`);

                const transcription = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(chunkPath),
                    model: "whisper-1",
                    language: "zh",
                    response_format: "verbose_json"
                });

                fullTranscript += `[時段 ${i * 10}:00 - ${(i + 1) * 10}:00]\n${transcription.text}\n\n`;
                totalWhisperDuration += (transcription.duration || 0);
            }
        } else {
            console.log('Transcribing single file...');
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(audioPath),
                model: "whisper-1",
                language: "zh",
                response_format: "verbose_json"
            });
            fullTranscript = transcription.text;
            totalWhisperDuration = (transcription.duration || 0);
        }

        // Step 3: Summarize
        const selectedModel = req.body.model || 'openai';
        const systemPrompt = "你是一個專業的影音轉型文字助手。這是一段錄音或影片的逐字稿，請將其整理成：1. 核心重點（列表） 2. 整體摘要 3. 逐段重點 4. 關鍵結論。請使用繁體中文。";

        console.log(`Summarizing file transcript with ${selectedModel}...`);
        const summaryData = await generateText(selectedModel, fullTranscript, systemPrompt);

        const gptCost = calculateCost(selectedModel === 'gemini' ? 'gemini-flash-latest' : 'gpt-4o-mini', summaryData.usage);
        const whisperCost = (totalWhisperDuration / 60) * PRICING['whisper-1'].minute;

        res.json({
            transcript: fullTranscript,
            summary: summaryData.text,
            originalName: originalName,
            usage: summaryData.usage,
            cost: (gptCost + whisperCost).toFixed(6)
        });
        console.log(`Response sent. Usage: ${JSON.stringify(summaryData.usage)}, Total Cost: ${gptCost + whisperCost}`);

    } catch (error) {
        console.error('Error during file transcription:', error);
        res.status(500).json({ error: error.message || 'Failed to process file' });
    } finally {
        // Cleanup: remove original uploaded file and the temp directory
        try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(workingDir)) fs.rmSync(workingDir, { recursive: true, force: true });
        } catch (e) {
            console.error('Cleanup error:', e);
        }
    }
});

app.post('/api/meeting/process', upload.single('file'), async (req, res) => {
    if (!req.file) {
        console.error('Meeting process: No file in request');
        return res.status(400).json({ error: 'No recording file received' });
    }

    console.log(`Meeting process: Received file ${req.file.originalname}, size: ${req.file.size}`);

    const inputPath = req.file.path;
    const selectedModel = req.body.model || 'openai';

    try {
        console.log(`Processing meeting recording using model: ${selectedModel}`);

        // Step 1: Transcribe using Whisper
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(inputPath),
            model: "whisper-1",
            language: "zh",
            response_format: "verbose_json"
        });

        // Step 2: Summarize with Meeting Focus
        const systemPrompt = "你是一個專業的會議記錄助手。請根據逐字稿整理出：1. 會議核心議題 2. 重點討論細節 3. 決議事項與 Action Items。請使用繁體中文。";
        const summaryData = await generateText(selectedModel, transcription.text, systemPrompt);

        console.log('Meeting process: Sending response');
        const gptCost = calculateCost(selectedModel === 'gemini' ? 'gemini-flash-latest' : 'gpt-4o-mini', summaryData.usage);
        const whisperCost = (transcription.duration || 0) / 60 * PRICING['whisper-1'].minute;

        res.json({
            transcript: transcription.text,
            summary: summaryData.text,
            url: '即時會議錄音',
            usage: summaryData.usage,
            cost: (gptCost + whisperCost).toFixed(6)
        });
        console.log(`Response sent. Usage: ${JSON.stringify(summaryData.usage)}, Total Cost: ${gptCost + whisperCost}`);

    } catch (error) {
        console.error('Error processing meeting:', error);
        res.status(500).json({ error: error.message || 'Failed to process meeting recording' });
    } finally {
        if (fs.existsSync(inputPath)) {
            try {
                fs.unlinkSync(inputPath);
            } catch (e) {
                console.error('Cleanup error:', e);
            }
        }
    }
});
// Library Endpoints
app.post('/api/library/save', async (req, res) => {
    const { url, transcript, summary, tag_id, cost } = req.body;

    if (!url || !transcript || !summary) {
        return res.status(400).json({ error: 'Missing required data' });
    }

    try {
        // Stage 1: Immediate save without embedding
        const info = db.prepare('INSERT INTO saved_transcripts (url, transcript, summary, embedding, tag_id, cost) VALUES (?, ?, ?, NULL, ?, ?)').run(url, transcript, summary, tag_id || null, cost || null);
        const recordId = info.lastInsertRowid;

        // Return success immediately to the client
        res.json({ id: recordId, message: 'Saved successfully, indexing in progress...' });

        // Stage 2: Background indexing (non-blocking)
        (async () => {
            try {
                process.stdout.write(`Background indexing for record ${recordId}...\n`);

                // Robust Truncation for long transcripts (OpenAI limit is 8191 tokens)
                // We combine summary and first part of transcript for best search context
                const searchContent = `Summary: ${summary}\n\nTranscript Snippet: ${transcript.substring(0, 5000)}`;

                const embeddingResponse = await openai.embeddings.create({
                    model: "text-embedding-3-small",
                    input: searchContent,
                });

                const embedding = JSON.stringify(embeddingResponse.data[0].embedding);
                db.prepare('UPDATE saved_transcripts SET embedding = ? WHERE id = ?').run(embedding, recordId);
                console.log(`Successfully indexed record ${recordId} in background.`);
            } catch (bgError) {
                console.error(`Background indexing failed for record ${recordId}:`, bgError.message);
            }
        })();

    } catch (error) {
        console.error('Database Error:', error);
        res.status(500).json({ error: 'Failed to save to database' });
    }
});

app.get('/api/library/history', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM saved_transcripts ORDER BY created_at DESC').all();
        res.json(rows);
    } catch (error) {
        console.error('Database Error:', error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

app.delete('/api/library/:id', (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM saved_transcripts WHERE id = ?').run(id);
        res.json({ message: 'Deleted successfully' });
    } catch (error) {
        console.error('Database Error:', error);
        res.status(500).json({ error: 'Failed to delete record' });
    }
});

app.patch('/api/library/:id/tag', (req, res) => {
    const { id } = req.params;
    const { tag_id } = req.body;
    try {
        db.prepare('UPDATE saved_transcripts SET tag_id = ? WHERE id = ?').run(tag_id || null, id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update tag' });
    }
});

// Tag Management Endpoints
app.get('/api/tags', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM tags ORDER BY name ASC').all();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tags' });
    }
});

app.post('/api/tags', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Tag name is required' });
    try {
        const info = db.prepare('INSERT INTO tags (name) VALUES (?)').run(name);
        res.json({ id: info.lastInsertRowid, name });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT') {
            res.status(400).json({ error: '標籤名稱已存在' });
        } else {
            res.status(500).json({ error: 'Failed to create tag' });
        }
    }
});

app.delete('/api/tags/:id', (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM tags WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete tag' });
    }
});

// Helper for Cosine Similarity
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Unified Text Generation Helper
async function generateText(provider, prompt, systemInstruction) {
    if (provider === 'gemini') {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        let parts = [{ text: prompt }];
        if (systemInstruction) {
            parts = [{ text: systemInstruction }, { text: prompt }];
        }

        const result = await model.generateContent(parts);
        const response = await result.response;
        const usage = {
            prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
            completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
            total_tokens: response.usageMetadata?.totalTokenCount || 0
        };
        return { text: response.text(), usage };
    } else {
        // Default to OpenAI
        let messages;
        if (Array.isArray(prompt)) {
            messages = [...prompt];
        } else {
            messages = [{ role: "user", content: prompt }];
        }

        if (systemInstruction) {
            messages.unshift({ role: "system", content: systemInstruction });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: messages,
        });

        return {
            text: completion.choices[0].message.content,
            usage: completion.usage
        };
    }
}

app.post('/api/chat', async (req, res) => {
    let { message, thread_id, model = 'openai', tag_id } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        // 1. Handle Thread Creation if needed
        let isNewThread = false;
        if (!thread_id) {
            const threadResult = db.prepare('INSERT INTO chat_threads (title) VALUES (?)').run('新對話');
            thread_id = threadResult.lastInsertRowid;
            isNewThread = true;
        }

        // 2. Fetch History (Last 10 messages)
        const history = db.prepare('SELECT role, content FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 10').all(thread_id);

        // 3. Generate embedding for the query (for RAG) - ALWAYS USE OPENAI for RAG
        const queryEmbeddingResponse = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: message,
        });
        const queryVector = queryEmbeddingResponse.data[0].embedding;

        // 4. Fetch all sources with embeddings
        let transcriptQuery = "SELECT id, url as source_url, transcript as content, embedding, 'reel' as type, created_at FROM saved_transcripts WHERE embedding IS NOT NULL";
        let docQuery = "SELECT id, name, filename, content, embedding, 'doc' as type, created_at FROM documents WHERE embedding IS NOT NULL";

        let transcripts, documents;

        if (tag_id) {
            transcriptQuery += " AND tag_id = ?";
            transcripts = db.prepare(transcriptQuery).all(tag_id);

            docQuery += " AND tag_id = ?";
            documents = db.prepare(docQuery).all(tag_id);
        } else {
            transcripts = db.prepare(transcriptQuery).all();
            documents = db.prepare(docQuery).all();
        }

        const allSources = [...transcripts, ...documents];

        // 5. Calculate similarity and rank
        const rankedResults = allSources.map(source => {
            try {
                const sourceVector = JSON.parse(source.embedding);
                return {
                    ...source,
                    similarity: cosineSimilarity(queryVector, sourceVector)
                };
            } catch (parseError) {
                console.error(`Error parsing embedding for source ${source.id}:`, parseError);
                return { ...source, similarity: 0 };
            }
        }).sort((a, b) => b.similarity - a.similarity).slice(0, 10);

        // 6. Construct Context
        const context = rankedResults.length > 0
            ? rankedResults.map(r => `[來源: ${r.type === 'reel' ? 'Reel URL' : '文件名稱'}: ${r.type === 'reel' ? r.source_url : r.name}] (存入日期: ${new Date(r.created_at).toLocaleString('zh-TW')})\n${r.content}`).join('\n\n---\n\n')
            : "資料庫中沒有相關資訊。";

        // 7. Auto-generate title if it's the first message
        if (isNewThread) {
            const titleData = await generateText(model, `針對以下提問縮短成一個 3-5 字的標題：${message}`);
            db.prepare('UPDATE chat_threads SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(titleData.text.replace(/["'「」]/g, ''), thread_id);
        } else {
            db.prepare('UPDATE chat_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(thread_id);
        }

        // 8. Prepare Prompt for Generation
        const systemPrompt = `你是一個專業助手。你的背景知識庫包含 Instagram 影音逐字稿與上傳的文件資料。
請優先根據資料庫內容回答，並參考歷史脈絡。請使用繁體中文。

**重要日期規範**：
1. 每一則資料都有標註「存入日期」。
2. 當使用者詢問特定日期（如「2月23日」）的內容時，你**必須**僅比對標註為該日期的資料。
3. 如果資料庫中該日期的內容與使用者的問題不符，請誠實回答「資料庫中 2/23 的資料與此主題無關」或「找不到該日期的相關紀錄」，絕對**不可以**拿其他日期（如 2/22）的內容來充數。
4. 在回答中，請適時提及你參考的是哪一個日期的資料。

背景知識資料庫內容：
${context}`;

        let answerText;
        let chatUsage;
        if (model === 'gemini') {
            // Construct history string or use robust chat session (basic concatenation for now)
            let messagesStr = history.map(h => `${h.role}: ${h.content}`).join('\n');
            const fullPrompt = `${messagesStr}\nuser: ${message}`;
            const result = await generateText('gemini', fullPrompt, systemPrompt);
            answerText = result.text;
            chatUsage = result.usage;
        } else {
            // OpenAI Format
            const chatMessagesForGPT = [
                ...history,
                { role: "user", content: message }
            ];
            const result = await generateText('openai', chatMessagesForGPT, systemPrompt);
            answerText = result.text;
            chatUsage = result.usage;
        }

        const gptCost = calculateCost(model === 'gemini' ? 'gemini-flash-latest' : 'gpt-4o-mini', chatUsage);
        const embeddingCost = (queryVector.length * 4) / 1000000 * PRICING['text-embedding-3-small'].input; // Rough estimate for embedding cost

        const sourcesData = rankedResults.map(r => ({
            id: r.id,
            url: r.type === 'reel' ? r.source_url : `http://localhost:3001/uploads/${r.filename}`,
            name: r.type === 'reel' ? 'Reel 原文' : r.name,
            type: r.type
        }));
        const sources = JSON.stringify(sourcesData);

        // 10. Save User and AI messages to history
        db.prepare('INSERT INTO chat_messages (thread_id, role, content) VALUES (?, ?, ?)').run(thread_id, 'user', message);
        db.prepare('INSERT INTO chat_messages (thread_id, role, content, sources) VALUES (?, ?, ?, ?)').run(thread_id, 'assistant', answerText, sources);

        res.json({
            thread_id,
            answer: answerText,
            sources: rankedResults.map(r => ({
                id: r.id,
                url: r.type === 'reel' ? r.source_url : `http://localhost:3001/uploads/${r.filename}`,
                name: r.type === 'reel' ? 'Reel 原文' : r.name,
                type: r.type
            })),
            usage: chatUsage,
            cost: (gptCost + embeddingCost).toFixed(6)
        });

    } catch (error) {
        console.error('Chat Error Details:', {
            message: error.message,
            stack: error.stack,
            thread_id,
            request_body: req.body
        });
        res.status(500).json({ error: `Failed to process chat: ${error.message}` });
    }
});

// Thread Management
app.get('/api/chat/threads', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM chat_threads ORDER BY updated_at DESC').all();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch threads' });
    }
});

app.get('/api/chat/threads/:id/messages', (req, res) => {
    const { id } = req.params;
    try {
        const rows = db.prepare('SELECT role, content, sources, created_at FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC').all(id);
        const formattedRows = rows.map(r => ({
            ...r,
            sources: r.sources ? JSON.parse(r.sources) : null
        }));
        res.json(formattedRows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

app.delete('/api/chat/threads/:id', (req, res) => {
    const { id } = req.params;
    console.log(`Attempting to delete chat thread with ID: ${id}`);
    try {
        const result = db.prepare('DELETE FROM chat_threads WHERE id = ?').run(id);
        if (result.changes > 0) {
            console.log(`Successfully deleted thread ${id} and associated messages.`);
            res.json({ message: 'Thread deleted' });
        } else {
            console.warn(`No thread found with ID: ${id}`);
            res.status(404).json({ error: '找不到該對話' });
        }
    } catch (error) {
        console.error('Delete thread error details:', {
            id,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: `刪除對話失敗: ${error.message}` });
    }
});

// Document Management Endpoints
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        let textContent = '';
        const filePath = req.file.path;

        try {
            if (req.file.mimetype === 'application/pdf') {
                const dataBuffer = fs.readFileSync(filePath);
                const parser = new pdf({ data: dataBuffer });
                const data = await parser.getText();
                textContent = data.text;
            } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                const result = await mammoth.extractRawText({ path: filePath });
                textContent = result.value;
            } else if (req.file.mimetype === 'text/plain') {
                textContent = fs.readFileSync(filePath, 'utf8');
            } else {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                return res.status(400).json({ error: '不支援的檔案格式，請上傳 PDF、Word 或 TXT 檔案。' });
            }
        } catch (parseError) {
            console.error('Parsing Error:', parseError);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.status(400).json({ error: '檔案解析失敗，可能是檔案損毀或格式不正確（例如：Word 檔案必須是 .docx 格式）。' });
        }

        if (!textContent || !textContent.trim()) {
            console.error('Text extraction resulted in empty content');
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.status(400).json({ error: '檔案中沒有可提取的文字內容。' });
        }

        console.log(`Extracted text length: ${textContent.length} characters`);

        // Generate embedding for the document content
        try {
            console.log('Requesting OpenAI embedding...');
            const embeddingRes = await openai.embeddings.create({
                model: "text-embedding-3-small",
                input: textContent.substring(0, 2000), // Reduced to safe limit (Chinese chars ~2 tokens)
            });
            console.log('Embedding received successfully');
            const embedding = JSON.stringify(embeddingRes.data[0].embedding);

            console.log('Saving document to database...');
            const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
            const result = db.prepare('INSERT INTO documents (name, filename, type, content, embedding, tag_id) VALUES (?, ?, ?, ?, ?, ?)').run(
                originalName,
                req.file.filename,
                req.file.mimetype,
                textContent,
                embedding,
                tag_id || null
            );
            console.log(`Document saved with ID: ${result.lastInsertRowid}`);

            res.json({
                id: result.lastInsertRowid,
                name: originalName,
                filename: req.file.filename,
                type: req.file.mimetype
            });
        } catch (aiError) {
            console.error('Detailed AI/DB Error:', aiError);
            res.status(500).json({ error: `處理失敗: ${aiError.message}` });
        }
    } catch (error) {
        console.error('General Upload Error:', error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: '伺服器發生錯誤，無法處理您的文件。' });
    }
});

app.get('/api/documents', (req, res) => {
    try {
        const docs = db.prepare('SELECT id, name, filename, type, content, tag_id, created_at FROM documents ORDER BY created_at DESC').all();
        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

app.patch('/api/documents/:id/tag', (req, res) => {
    const { id } = req.params;
    const { tag_id } = req.body;
    try {
        db.prepare('UPDATE documents SET tag_id = ? WHERE id = ?').run(tag_id || null, id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update tag' });
    }
});

app.delete('/api/documents/:id', (req, res) => {
    const { id } = req.params;
    console.log(`Attempting to delete document with ID: ${id}`);
    try {
        const doc = db.prepare('SELECT filename FROM documents WHERE id = ?').get(id);
        if (doc) {
            console.log(`Found document to delete: ${doc.filename}`);
            const filePath = path.join(__dirname, 'uploads', doc.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Deleted file: ${filePath}`);
            } else {
                console.warn(`File not found on disk: ${filePath}`);
            }
            db.prepare('DELETE FROM documents WHERE id = ?').run(id);
            console.log(`Deleted record from database for ID: ${id}`);
            res.json({ success: true });
        } else {
            console.warn(`Document not found in database for ID: ${id}`);
            res.status(404).json({ error: '找不到該文件' });
        }
    } catch (error) {
        console.error('Delete error details:', {
            id,
            errorMessage: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: `刪除文件時發生錯誤: ${error.message}` });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
