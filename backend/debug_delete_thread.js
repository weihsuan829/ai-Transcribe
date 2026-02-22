import axios from 'axios';

const testDeleteThread = async (id) => {
    try {
        console.log(`Attempting to delete chat thread with ID: ${id}`);
        const response = await axios.delete(`http://localhost:3001/api/chat/threads/${id}`);
        console.log('Delete Response:', response.data);
    } catch (error) {
        console.error('Delete Error:', error.response ? error.response.data : error.message);
    }
};

// Replace with a valid ID from the database
testDeleteThread(14);
