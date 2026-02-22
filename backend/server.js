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
`);

// Migration: Check if embedding column exists (in case table was created before)
try {
    db.exec("ALTER TABLE saved_transcripts ADD COLUMN embedding TEXT");
} catch (e) {
    // Column already exists or other error
}

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
    next();
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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
        });

        console.log('Transcription complete');

        // Step 3: Summarize using selected model
        const selectedModel = req.body.model || 'openai';
        const systemPrompt = "你是一個專業的影音轉型文字助手。請將下方的逐字稿整理成：1. 核心重點（列表） 2. 摘要 3. 建議。請使用繁體中文。";
        console.log(`Using ${selectedModel} for summarization`);

        let summary;
        if (selectedModel === 'gemini') {
            summary = await generateText('gemini', transcription.text, systemPrompt);
        } else {
            summary = await generateText('openai', transcription.text, systemPrompt);
        }

        res.json({
            transcript: transcription.text,
            summary: summary
        });

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
        for (let i = 0; i < chunks.length; i++) {
            const chunkPath = path.join(workingDir, chunks[i]);
            console.log(`Transcribing chunk ${i + 1}/${chunks.length}...`);

            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(chunkPath),
                model: "whisper-1",
                language: "zh",
            });

            fullTranscript += `[時段 ${i * 10}:00 - ${(i + 1) * 10}:00]\n${transcription.text}\n\n`;
        }

        // Step 4: Summarize the whole thing
        const selectedModel = req.body.model || 'openai';
        const systemPrompt = "你是一個專業的影音轉型文字助手。這是一段長影片的逐字稿，請將其整理成：1. 核心重點（列表） 2. 整體摘要 3. 逐段重點 4. 關鍵結論。請使用繁體中文。";

        console.log(`Summarizing long transcript with ${selectedModel}...`);
        const summary = await generateText(selectedModel, fullTranscript, systemPrompt);

        res.json({
            transcript: fullTranscript,
            summary: summary
        });

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

// Library Endpoints
app.post('/api/library/save', async (req, res) => {
    const { url, transcript, summary } = req.body;

    if (!url || !transcript || !summary) {
        return res.status(400).json({ error: 'Missing required data' });
    }

    try {
        // Stage 1: Immediate save without embedding
        const info = db.prepare('INSERT INTO saved_transcripts (url, transcript, summary, embedding) VALUES (?, ?, ?, NULL)').run(url, transcript, summary);
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
            // Gemini doesn't strictly have system roles in the same way, but prepending works well
            parts = [{ text: systemInstruction }, { text: prompt }];
        }

        const result = await model.generateContent(parts);
        const response = await result.response;
        return response.text();
    } else {
        // Default to OpenAI
        const messages = [{ role: "user", content: prompt }];
        if (systemInstruction) {
            messages.unshift({ role: "system", content: systemInstruction });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: messages,
        });
        return completion.choices[0].message.content;
    }
}

app.post('/api/chat', async (req, res) => {
    let { message, thread_id, model = 'openai' } = req.body;

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
        const transcripts = db.prepare("SELECT id, url as source_url, transcript as content, embedding, 'reel' as type FROM saved_transcripts WHERE embedding IS NOT NULL").all();
        const documents = db.prepare("SELECT id, name, filename, content, embedding, 'doc' as type FROM documents WHERE embedding IS NOT NULL").all();

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
        }).sort((a, b) => b.similarity - a.similarity).slice(0, 5);

        // 6. Construct Context
        const context = rankedResults.length > 0
            ? rankedResults.map(r => `[來源: ${r.type === 'reel' ? 'Reel URL' : '文件名稱'}: ${r.type === 'reel' ? r.source_url : r.name}]\n${r.content}`).join('\n\n---\n\n')
            : "資料庫中沒有相關資訊。";

        // 7. Auto-generate title if it's the first message
        if (isNewThread) {
            const newTitle = await generateText(model, `針對以下提問縮短成一個 3-5 字的標題：${message}`);
            db.prepare('UPDATE chat_threads SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newTitle.replace(/["'「」]/g, ''), thread_id);
        } else {
            db.prepare('UPDATE chat_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(thread_id);
        }

        // 8. Prepare Prompt for Generation
        const systemPrompt = "你是一個專業助手。你的背景知識庫包含 Instagram 影音逐字稿與上傳的文件資料。請優先根據資料庫內容回答，並參考歷史脈絡。請使用繁體中文。\n背景知識資料庫內容：\n" + context;

        let answer;
        if (model === 'gemini') {
            // Construct history string or use robust chat session (basic concatenation for now)
            let messagesStr = history.map(h => `${h.role}: ${h.content}`).join('\n');
            const fullPrompt = `${messagesStr}\nuser: ${message}`;
            answer = await generateText('gemini', fullPrompt, systemPrompt);
        } else {
            // OpenAI Format
            const chatMessagesForGPT = [
                { role: "system", content: systemPrompt },
                ...history,
                { role: "user", content: message }
            ];
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: chatMessagesForGPT,
            });
            answer = completion.choices[0].message.content;
        }

        const sourcesData = rankedResults.map(r => ({
            id: r.id,
            url: r.type === 'reel' ? r.source_url : `http://localhost:3001/uploads/${r.filename}`,
            name: r.type === 'reel' ? 'Reel 原文' : r.name,
            type: r.type
        }));
        const sources = JSON.stringify(sourcesData);

        // 10. Save User and AI messages to history
        db.prepare('INSERT INTO chat_messages (thread_id, role, content) VALUES (?, ?, ?)').run(thread_id, 'user', message);
        db.prepare('INSERT INTO chat_messages (thread_id, role, content, sources) VALUES (?, ?, ?, ?)').run(thread_id, 'assistant', answer, sources);

        res.json({
            thread_id,
            answer,
            sources: rankedResults.map(r => ({
                id: r.id,
                url: r.type === 'reel' ? r.source_url : `http://localhost:3001/uploads/${r.filename}`,
                name: r.type === 'reel' ? 'Reel 原文' : r.name,
                type: r.type
            }))
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
            } else {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                return res.status(400).json({ error: '不支援的檔案格式，請上傳 PDF 或 Word 檔案。' });
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
            const result = db.prepare('INSERT INTO documents (name, filename, type, content, embedding) VALUES (?, ?, ?, ?, ?)').run(
                originalName,
                req.file.filename,
                req.file.mimetype,
                textContent,
                embedding
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
        const docs = db.prepare('SELECT id, name, filename, type, content, created_at FROM documents ORDER BY created_at DESC').all();
        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch documents' });
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
