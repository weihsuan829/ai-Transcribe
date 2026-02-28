import axios from 'axios';

const API_BASE_URL = 'http://localhost:3001/api';

export const transcribeUrl = async (url, model = 'openai') => {
    try {
        const response = await axios.post(`${API_BASE_URL}/transcribe`, { url, model });
        return response.data;
    } catch (error) {
        console.error('API Error:', error);
        throw new Error(error.response?.data?.error || 'Failed to connect to server');
    }
};

export const transcribeLongUrl = async (url, model = 'openai') => {
    try {
        const response = await axios.post(`${API_BASE_URL}/transcribe-long`, { url, model });
        return response.data;
    } catch (error) {
        console.error('API Error:', error);
        throw new Error(error.response?.data?.error || '長影音處理失敗，可能是連結無效或超過長度限制。');
    }
};

export const transcribeFile = async (file, model = 'openai') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', model);
    try {
        const response = await axios.post(`${API_BASE_URL}/transcribe-file`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data;
    } catch (error) {
        console.error('API Error:', error);
        throw new Error(error.response?.data?.error || '檔案轉譯失敗，請檢查格式或檔案大小。');
    }
};

export const saveToLibrary = async (data) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/library/save`, data);
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.error || 'Failed to save to library');
    }
};

export const getHistory = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/library/history`);
        return response.data;
    } catch (error) {
        throw new Error('Failed to fetch history');
    }
};

export const deleteFromHistory = async (id) => {
    try {
        const response = await axios.delete(`${API_BASE_URL}/library/${id}`);
        return response.data;
    } catch (error) {
        throw new Error('Failed to delete transcript');
    }
};

export const sendChatMessage = async (message, threadId = null, model = 'openai', tagId = null) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/chat`, {
            message,
            thread_id: threadId,
            model,
            tag_id: tagId
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.error || 'Failed to send chat message');
    }
};

export const getThreads = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/chat/threads`);
        return response.data;
    } catch (error) {
        throw new Error('Failed to fetch threads');
    }
};

export const getThreadMessages = async (threadId) => {
    try {
        const response = await axios.get(`${API_BASE_URL}/chat/threads/${threadId}/messages`);
        return response.data;
    } catch (error) {
        throw new Error('Failed to fetch messages');
    }
};

export const deleteThread = async (threadId) => {
    try {
        const response = await axios.delete(`${API_BASE_URL}/chat/threads/${threadId}`);
        return response.data;
    } catch (error) {
        throw new Error('Failed to delete thread');
    }
};

export const getDocuments = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/documents`);
        return response.data;
    } catch (error) {
        throw new Error('Failed to fetch documents');
    }
};

export const uploadDocument = async (file, tagId = null) => {
    const formData = new FormData();
    formData.append('file', file);
    if (tagId) formData.append('tag_id', tagId);
    try {
        const response = await axios.post(`${API_BASE_URL}/documents/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.error || 'Failed to upload document');
    }
};

export const updateLibraryTag = async (id, tagId) => {
    try {
        const response = await axios.patch(`${API_BASE_URL}/library/${id}/tag`, { tag_id: tagId });
        return response.data;
    } catch (error) {
        throw new Error('Failed to update library tag');
    }
};

export const updateDocumentTag = async (id, tagId) => {
    try {
        const response = await axios.patch(`${API_BASE_URL}/documents/${id}/tag`, { tag_id: tagId });
        return response.data;
    } catch (error) {
        throw new Error('Failed to update document tag');
    }
};

export const deleteDocument = async (id) => {
    try {
        const response = await axios.delete(`${API_BASE_URL}/documents/${id}`);
        return response.data;
    } catch (error) {
        console.error('Delete API Error:', error);
        throw new Error(error.response?.data?.error || 'Failed to delete document');
    }
};

// Tag Management
export const getTags = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/tags`);
        return response.data;
    } catch (error) {
        throw new Error('Failed to fetch tags');
    }
};

export const createTag = async (name) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/tags`, { name });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.error || 'Failed to create tag');
    }
};

export const deleteTag = async (id) => {
    try {
        const response = await axios.delete(`${API_BASE_URL}/tags/${id}`);
        return response.data;
    } catch (error) {
        throw new Error('Failed to delete tag');
    }
};

export const processMeeting = async (audioBlob, model = 'openai') => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', model);
    try {
        const response = await axios.post(`${API_BASE_URL}/meeting/process`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data;
    } catch (error) {
        console.error('Meeting Processing Error:', error);
        throw new Error(error.response?.data?.error || '會議處理失敗');
    }
};
