import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

async function test() {
    try {
        console.log('Testing OpenAI Embeddings...');
        const res = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: "Hello World",
        });
        console.log('Success! Vector length:', res.data[0].embedding.length);
    } catch (err) {
        console.error('Error:', err.message);
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
        }
    }
}

test();
