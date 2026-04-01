import axios from 'axios';

// Fallback to localhost so a missing VITE_MAIN_API_URL env var doesn't silently
// send every request to '/undefined/...' on deployed builds.
export const API_URL = import.meta.env.VITE_MAIN_API_URL || 'http://localhost:8000/api/v1';

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 15000, // 15s — fail fast on cold-start backends
});

// Inject auth token on every request from localStorage.
// This avoids a race condition where SettingsContext fires API calls
// before AuthContext.useEffect has set api.defaults.headers.
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers = config.headers || {};
        config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
});

// Retry interceptor for 503 and transient errors
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const config = error.config;

        // Don't retry if no config or already retried 3 times
        if (!config || config._retryCount >= 3) {
            return Promise.reject(error);
        }

        // Don't retry auth endpoints — surface errors immediately to the user
        const url = config.url || '';
        if (url.includes('/auth/')) {
            return Promise.reject(error);
        }

        // Check if error is retryable (503, 429, network errors)
        const status = error.response?.status;
        const isRetryable = status === 503 || status === 429 || status === 502 || !error.response;

        if (isRetryable) {
            config._retryCount = (config._retryCount || 0) + 1;
            const delay = Math.min(1000 * Math.pow(2, config._retryCount - 1), 10000);
            console.log(`Retrying request (attempt ${config._retryCount}/3) in ${delay}ms...`);

            await new Promise(resolve => setTimeout(resolve, delay));
            return api(config);
        }

        return Promise.reject(error);
    }
);

export const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
};

export const signup = async (email, password, fullName) => {
    const response = await api.post('/auth/signup', { email, password, full_name: fullName });
    return response.data;
};

export const loginWithGoogle = async (accessToken) => {
    const response = await api.post('/auth/google', { access_token: accessToken });
    return response.data;
};

export const createProject = async (name) => {
    const response = await api.post('/projects/', { name });
    return response.data;
};

export const deleteProject = async (projectId) => {
    await api.delete(`/projects/${projectId}`);
};

export const getProjects = async () => {
    const response = await api.get('/projects/');
    return response.data;
};

export const uploadDocument = async (projectId, file, onProgress, bookOptions = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', projectId);

    // Book Store fields (only sent if user chose to share publicly)
    if (bookOptions.isPublic) {
        formData.append('is_public', 'true');
        if (bookOptions.bookTitle) formData.append('book_title', bookOptions.bookTitle);
        if (bookOptions.bookAuthor) formData.append('book_author', bookOptions.bookAuthor);
        if (bookOptions.bookDescription) formData.append('book_description', bookOptions.bookDescription);
        if (bookOptions.bookTags) formData.append('book_tags', bookOptions.bookTags);
    }

    const token = localStorage.getItem('token');
    const response = await axios.post(`${API_URL}/documents/upload`, formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        onUploadProgress: (progressEvent) => {
            if (onProgress) {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                onProgress(percentCompleted);
            }
        },
        timeout: 120000, // 2 min for large files
    });
    return response.data;
};
export const getDocuments = async (projectId) => {
    const response = await api.get(`/documents/${projectId}`, { params: { _: Date.now() } });
    return response.data;
};

// ============== Book Store API ==============

export const getPublicBooks = async (page = 1, search = '', tags = null, pageSize = 20) => {
    const params = { page, page_size: pageSize };
    if (search) params.search = search;
    if (tags && tags.length > 0) params.tags = tags.join(',');
    const response = await api.get('/books/', { params });
    return response.data;
};

export const getMyBooks = async () => {
    const response = await api.get('/books/my');
    return response.data;
};

export const getBook = async (bookId) => {
    const response = await api.get(`/books/${bookId}`);
    return response.data;
};

export const importBook = async (bookId, projectId) => {
    const response = await api.post(`/books/${bookId}/import`, { project_id: projectId });
    return response.data;
};

export const updateBook = async (bookId, updates) => {
    const response = await api.patch(`/books/${bookId}`, updates);
    return response.data;
};

export const deleteBook = async (bookId) => {
    const response = await api.delete(`/books/${bookId}`);
    return response.data;
};

export const getQueueStatus = async () => {
    const response = await api.get('/documents/queue/status');
    return response.data;
};

export const getChatHistory = async (projectId) => {
    const response = await api.get(`/chat/history/${projectId}`);
    return response.data;
};


export const chatMessage = async (projectId, message, history = []) => {
    const response = await api.post('/chat/message', {
        project_id: projectId,
        message,
        session_history: history
    });
    return response.data;
};

export const chatMessageStream = async (projectId, message, history = [], selectedDocuments = [], onChunk, onComplete) => {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/chat/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    project_id: projectId,
                    message,
                    session_history: history,
                    selected_documents: selectedDocuments
                })
            });

            // Check for retryable HTTP errors
            if (response.status === 503 || response.status === 429 || response.status === 502) {
                const delay = Math.min(1500 * Math.pow(2, attempt), 10000);
                console.log(`Service unavailable (${response.status}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // Check for other HTTP errors
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || `HTTP error ${response.status}`);
            }

            // Check for null body
            if (!response.body) {
                throw new Error('Response body is empty');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let sources = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                fullText += chunk;

                // Check for sources delimiter in accumulated text
                if (fullText.includes('__SOURCES__:')) {
                    const parts = fullText.split('__SOURCES__:');
                    const textPart = parts[0];
                    const sourcesJson = parts[1];

                    try {
                        // Clean and parse sources
                        const cleanSourcesJson = sourcesJson.trim();
                        sources = JSON.parse(cleanSourcesJson);
                        console.log('Sources parsed successfully:', sources);

                        // Update with clean text
                        onChunk(textPart);
                        fullText = textPart; // Reset to just text without marker
                    } catch (e) {
                        console.warn('JSON parse incomplete, continuing...', e.message);
                        // Continue reading, JSON might be split across chunks
                    }
                } else {
                    // Normal streaming without sources marker
                    onChunk(fullText);
                }
            }

            // Stream complete - use parsed sources
            console.log('Stream finished. Sources:', sources);
            onComplete({ answer: fullText, sources: sources });
            return; // Success, exit retry loop

        } catch (error) {
            lastError = error;
            const errorStr = error.message?.toLowerCase() || '';
            const isRetryable = errorStr.includes('503') || errorStr.includes('service unavailable') ||
                errorStr.includes('network') || errorStr.includes('fetch');

            if (isRetryable && attempt < maxRetries - 1) {
                const delay = Math.min(1500 * Math.pow(2, attempt), 10000);
                console.log(`Retryable error: ${error.message}. Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            console.error("Streaming error:", error);
            onComplete({ answer: `Error: ${error.message}. Please try again.`, sources: [] });
            return;
        }
    }

    // All retries exhausted
    console.error("All retries exhausted:", lastError);
    onComplete({ answer: "Service temporarily unavailable. Please try again in a moment.", sources: [] });
};

export const getProjectSummary = async (projectId, selectedDocuments = []) => {
    const response = await api.post('/chat/summary', {
        project_id: projectId,
        selected_documents: selectedDocuments
    });
    return response.data;
};

// generateQA removed


export const generateMCQ = async (projectId, topic, numQuestions, selectedDocuments = [], difficulty = 'medium') => {
    const response = await api.post('/mcq/generate', {
        project_id: projectId,
        topic: topic,
        num_questions: parseInt(numQuestions),
        selected_documents: selectedDocuments,
        difficulty: difficulty
    });
    return response.data;
};

export const getTopics = async (projectId) => {
    const response = await api.get(`/mcq/topics/${projectId}`);
    return response.data;
};

export const submitEvaluation = async (projectId, question, userAnswer) => {
    const response = await api.post('/evaluation/submit', {
        project_id: projectId,
        question,
        user_answer: userAnswer
    });
    return response.data;
};

export const generateSubjectiveTest = async (projectId, topic, numQuestions, selectedDocuments = [], answerSize = 'medium') => {
    const response = await api.post('/evaluation/generate-test', {
        project_id: projectId,
        topic: topic,
        num_questions: parseInt(numQuestions),
        selected_documents: selectedDocuments,
        answer_size: answerSize
    });
    return response.data;
};

export const submitSubjectiveTest = async (testId, answers) => {
    const response = await api.post('/evaluation/submit-test', {
        test_id: testId,
        answers: answers
    });
    return response.data;
};

export const deleteDocument = async (projectId, documentId) => {
    const response = await api.delete(`/documents/${documentId}`, {
        params: { project_id: projectId }
    });
    return response.data;
};

export const generateNotes = async (projectId, noteType, topic, selectedDocuments = []) => {
    const response = await api.post('/notes/generate', {
        project_id: projectId,
        note_type: noteType,
        topic: topic,
        selected_documents: selectedDocuments
    });
    return response.data;
};


// ============== Saved Q&A (Subjective Tests) API ==============

export const getSavedQATests = async (projectId) => {
    const response = await api.get(`/evaluation/saved/${projectId}`);
    return response.data;
};

export const getSavedQATest = async (testId) => {
    const response = await api.get(`/evaluation/saved/view/${testId}`);
    return response.data;
};

export const deleteSavedQATest = async (testId) => {
    const response = await api.delete(`/evaluation/saved/${testId}`);
    return response.data;
};

// ============== Saved Quiz (MCQ Tests) API ==============

export const getSavedQuizzes = async (projectId) => {
    const response = await api.get(`/mcq/saved/${projectId}`);
    return response.data;
};

export const getSavedQuiz = async (testId) => {
    const response = await api.get(`/mcq/saved/view/${testId}`);
    return response.data;
};

export const deleteSavedQuiz = async (testId) => {
    const response = await api.delete(`/mcq/saved/${testId}`);
    return response.data;
};

// ============== Saved Notes API ==============

export const getSavedNotes = async (projectId) => {
    const response = await api.get(`/notes/saved/${projectId}`);
    return response.data;
};

export const getSavedNote = async (noteId) => {
    const response = await api.get(`/notes/saved/view/${noteId}`);
    return response.data;
};

export const deleteSavedNote = async (noteId) => {
    const response = await api.delete(`/notes/saved/${noteId}`);
    return response.data;
};

// ============== Learning API (Adaptive Learning System) ==============

// Performance Tracking
export const recordPerformance = async (projectId, topic, correct, wrong) => {
    const response = await api.post('/learning/performance/record', {
        project_id: projectId,
        topic,
        correct,
        wrong
    });
    return response.data;
};

export const getPerformance = async (projectId, topic = null) => {
    const params = topic ? { topic } : {};
    const response = await api.get(`/learning/performance/${projectId}`, { params });
    return response.data;
};

// Weakness Detection
export const getWeakTopics = async (projectId, topK = 5, threshold = 0.3) => {
    const response = await api.get(`/learning/weak-topics/${projectId}`, {
        params: { top_k: topK, threshold }
    });
    return response.data;
};

// Spaced Repetition
export const createReviewCard = async (projectId, topic, question, answer) => {
    const response = await api.post('/learning/review-cards', {
        project_id: projectId,
        topic,
        question,
        answer
    });
    return response.data;
};

export const createCardsFromQuiz = async (projectId, topic, questions, wrongOnly = true) => {
    const response = await api.post('/learning/review-cards/from-quiz', {
        project_id: projectId,
        topic,
        questions,
        wrong_only: wrongOnly
    });
    return response.data;
};

export const getDueCards = async (projectId = null, limit = 20) => {
    const params = { limit };
    if (projectId) params.project_id = projectId;
    const response = await api.get('/learning/review-cards/due', { params });
    return response.data;
};

export const recordReview = async (cardId, quality) => {
    const response = await api.post(`/learning/review-cards/${cardId}/review`, {
        quality
    });
    return response.data;
};

export const deleteReviewCard = async (cardId) => {
    const response = await api.delete(`/learning/review-cards/${cardId}`);
    return response.data;
};

export const getReviewStats = async (projectId = null) => {
    const params = projectId ? { project_id: projectId } : {};
    const response = await api.get('/learning/review-stats', { params });
    return response.data;
};

// Learning Dashboard
export const getLearningDashboard = async (projectId) => {
    const response = await api.get(`/learning/dashboard/${projectId}`);
    return response.data;
};

export const getAllLearningStats = async () => {
    const response = await api.get('/learning/stats/all');
    return response.data;
};

// Knowledge Graph
export const buildKnowledgeGraph = async (projectId, topics, forceRebuild = false) => {
    const response = await api.post(`/learning/knowledge-graph/${projectId}/build`, {
        topics,
        force_rebuild: forceRebuild
    });
    return response.data;
};

export const getKnowledgeGraph = async (projectId) => {
    const response = await api.get(`/learning/knowledge-graph/${projectId}`);
    return response.data;
};

export const getRelatedTopics = async (projectId, topic, maxDistance = 2) => {
    const response = await api.get(
        `/learning/knowledge-graph/${projectId}/related/${encodeURIComponent(topic)}`,
        { params: { max_distance: maxDistance } }
    );
    return response.data;
};

export const getLearningPath = async (projectId, targetTopics = null) => {
    const params = targetTopics ? { target_topics: targetTopics.join(',') } : {};
    const response = await api.get(`/learning/knowledge-graph/${projectId}/learning-path`, { params });
    return response.data;
};

export const getTopicPrerequisites = async (projectId, topic) => {
    const response = await api.get(
        `/learning/knowledge-graph/${projectId}/prerequisites/${encodeURIComponent(topic)}`
    );
    return response.data;
};

export const getSuggestedTopic = async (projectId) => {
    const response = await api.get(`/learning/suggested-topic/${projectId}`);
    return response.data;
};

// ============== Search API ==============

export const searchDocuments = async (projectId, query, documentIds = null, limit = 10) => {
    const response = await api.post(`/documents/${projectId}/search`, {
        query,
        document_ids: documentIds,
        limit
    });
    return response.data;
};

// ============== Knowledge Graph API ==============

// Get full knowledge graph for visualization
export const getKnowledgeGraphVisualization = async (projectId) => {
    const response = await api.get(`/knowledge-graph/graph/${projectId}`);
    return response.data;
};

// Get topic summary using RAG
export const getTopicSummary = async (projectId, topic, forceRegenerate = false) => {
    const response = await api.post('/knowledge-graph/topic-summary', {
        project_id: projectId,
        topic,
        force_regenerate: forceRegenerate
    });
    return response.data;
};

// Record user interaction with graph
export const recordGraphInteraction = async (projectId, topic, eventType, durationMs = 0, metadata = null) => {
    const response = await api.post('/knowledge-graph/analytics/record', {
        project_id: projectId,
        topic,
        event_type: eventType,
        duration_ms: durationMs,
        metadata
    });
    return response.data;
};

// Record batch interactions
export const recordBatchInteractions = async (projectId, interactions) => {
    const response = await api.post('/knowledge-graph/analytics/record-batch', {
        project_id: projectId,
        interactions
    });
    return response.data;
};

// Get user analytics
export const getGraphAnalytics = async (projectId, days = 7) => {
    const response = await api.get(`/knowledge-graph/analytics/${projectId}`, {
        params: { days }
    });
    return response.data;
};

// Get learning suggestions
export const getLearningSuggestions = async (projectId, currentTopic = null, limit = 3) => {
    const response = await api.post('/knowledge-graph/suggestions', {
        project_id: projectId,
        current_topic: currentTopic,
        limit
    });
    return response.data;
};

// Start learning session
export const startLearningSession = async (projectId) => {
    const response = await api.post('/knowledge-graph/session/start', {
        project_id: projectId
    });
    return response.data;
};

// End learning session
export const endLearningSession = async (sessionId, topicsVisited, totalTimeMs) => {
    const response = await api.post('/knowledge-graph/session/end', {
        session_id: sessionId,
        topics_visited: topicsVisited,
        total_time_ms: totalTimeMs
    });
    return response.data;
};

// ============== User Data API (replaces localStorage) ==============

// --- Settings ---
export const getUserSettings = async () => {
    const response = await api.get('/user-data/settings');
    return response.data;
};

export const saveUserSettings = async (settings) => {
    const response = await api.put('/user-data/settings', { settings });
    return response.data;
};

// --- Bookmarks ---
export const getBookmarks = async (projectId) => {
    const response = await api.get(`/user-data/bookmarks/${projectId}`);
    return response.data;
};

export const addBookmark = async (projectId, title, note = '', documentId = null, type = 'general', highlightText = null, color = null) => {
    const body = {
        project_id: projectId,
        title,
        note,
        document_id: documentId,
        type,
    };
    if (highlightText) body.highlight_text = highlightText;
    if (color) body.color = color;
    const response = await api.post('/user-data/bookmarks', body);
    return response.data;
};

export const updateBookmark = async (bookmarkId, updates) => {
    const response = await api.patch(`/user-data/bookmarks/${bookmarkId}`, updates);
    return response.data;
};

export const deleteBookmark = async (bookmarkId) => {
    const response = await api.delete(`/user-data/bookmarks/${bookmarkId}`);
    return response.data;
};

// --- Study Activity ---
export const getStudyActivity = async (projectId, days = 90) => {
    const response = await api.get(`/user-data/activity/${projectId}`, { params: { days } });
    return response.data;
};

export const recordStudyActivity = async (projectId, activityType, meta = null) => {
    const response = await api.post('/user-data/activity', {
        project_id: projectId,
        activity_type: activityType,
        meta,
    });
    return response.data;
};

// --- Learning Progress ---
export const getLearningProgress = async (projectId) => {
    const response = await api.get(`/user-data/progress/${projectId}`);
    return response.data;
};

export const saveLearningProgress = async (projectId, completedTopics) => {
    const response = await api.put('/user-data/progress', {
        project_id: projectId,
        completed_topics: completedTopics,
    });
    return response.data;
};

// --- Pomodoro ---
export const getPomodoro = async (projectId = null, documentId = null) => {
    const params = {};
    if (projectId) params.project_id = projectId;
    if (documentId) params.document_id = documentId;
    const response = await api.get('/user-data/pomodoro', { params });
    return response.data;
};

export const savePomodoro = async (sessions, focusTimeMinutes, projectId = null, documentId = null) => {
    const response = await api.put('/user-data/pomodoro', {
        project_id: projectId,
        document_id: documentId,
        sessions,
        focus_time_minutes: focusTimeMinutes,
    });
    return response.data;
};

// --- Recent Searches ---
export const getRecentSearches = async (projectId) => {
    const response = await api.get(`/user-data/searches/${projectId}`);
    return response.data;
};

export const saveRecentSearch = async (projectId, query) => {
    const response = await api.post('/user-data/searches', {
        project_id: projectId,
        query,
    });
    return response.data;
};

export const clearRecentSearches = async (projectId) => {
    const response = await api.delete(`/user-data/searches/${projectId}`);
    return response.data;
};

// --- Streaks ---
export const getStreak = async (projectId) => {
    const response = await api.get(`/user-data/streaks/${projectId}`);
    return response.data;
};

export const updateStreak = async (projectId) => {
    const response = await api.post(`/user-data/streaks/${projectId}`);
    return response.data;
};

// --- Gamification ---
export const getGamification = async () => {
    const response = await api.get('/user-data/gamification');
    return response.data;
};

export const awardXP = async (activityType, meta = null) => {
    const response = await api.post('/user-data/gamification/award-xp', {
        activity_type: activityType,
        meta,
    });
    return response.data;
};

// ============== Flashcard API ==============

export const getFlashcardSets = async (projectId) => {
    const response = await api.get(`/flashcards/${projectId}`);
    return response.data;
};

export const createFlashcardSet = async (projectId, title, topic, description, cards) => {
    const response = await api.post(`/flashcards/${projectId}`, {
        title,
        topic,
        description,
        cards
    });
    return response.data;
};

export const updateFlashcardSet = async (setId, updates) => {
    const response = await api.put(`/flashcards/${setId}`, updates);
    return response.data;
};

export const deleteFlashcardSet = async (setId) => {
    const response = await api.delete(`/flashcards/${setId}`);
    return response.data;
};

export const getFlashcards = async (setId) => {
    const response = await api.get(`/flashcards/${setId}/cards`);
    return response.data;
};

// ============== Mindmap API ==============

export const getMindmaps = async (projectId) => {
    const response = await api.get(`/mindmaps/${projectId}`);
    return response.data;
};

export const generateMindmap = async (projectId, title, topic, selectedDocuments = []) => {
    const response = await api.post(`/mindmaps/${projectId}/generate`, {
        title,
        topic,
        selected_documents: selectedDocuments
    });
    return response.data;
};

export const getMindmap = async (mindmapId) => {
    const response = await api.get(`/mindmaps/${mindmapId}/view`);
    return response.data;
};

export const updateMindmap = async (mindmapId, updates) => {
    const response = await api.put(`/mindmaps/${mindmapId}`, updates);
    return response.data;
};

export const deleteMindmap = async (mindmapId) => {
    const response = await api.delete(`/mindmaps/${mindmapId}`);
    return response.data;
};

// ============== Legacy API for Learning Path (TopicMindmap/TopicFlashcards) ==============
// These are kept for backward compatibility with the Learning Path feature

export const generateMindmapLegacy = async (projectId, topic, selectedDocuments = []) => {
    // Generate a mindmap with auto-generated title for Learning Path
    const response = await api.post(`/mindmaps/${projectId}/generate`, {
        title: `${topic} - Mindmap`,
        topic,
        selected_documents: selectedDocuments
    });
    return response.data;
};

export const generateFlashcardsLegacy = async (projectId, topic, numCards = 8, selectedDocuments = []) => {
    // For Learning Path, we generate flashcards on-the-fly without saving
    // This would need a separate endpoint or we can use the LLM directly
    // For now, return a placeholder structure
    return {
        topic,
        cards: []
    };
};

// Generate flashcards with AI and create a set
export const generateFlashcardsWithAI = async (projectId, topic, numCards = 10, selectedDocuments = []) => {
    const response = await api.post(`/flashcards/${projectId}/generate`, {
        topic,
        num_cards: numCards,
        selected_documents: selectedDocuments
    });
    return response.data;
};

// ============== Real-Time Document Progress (SSE) ==============

/**
 * Subscribe to real-time document processing progress via Server-Sent Events.
 *
 * @param {string} documentId - The document ID to watch
 * @param {function} onEvent - Callback for each progress event
 *   Receives: { stage: string, progress: number, message: string, timestamp: string }
 *   Stages: extracting → chunking → embedding → topics → graph → completed | failed
 * @param {function} onError - Optional error callback
 * @returns {function} cleanup - Call this to close the SSE connection
 *
 * Usage:
 *   const cleanup = subscribeDocumentProgress(docId, (event) => {
 *     setProgressStage(event.stage);
 *     setProgressPercent(event.progress);
 *   });
 *   // Later: cleanup();
 */
export const subscribeDocumentProgress = (documentId, onEvent, onError = null) => {
    const token = localStorage.getItem('token');
    const url = `${API_URL}/progress/${documentId}?token=${encodeURIComponent(token)}`;

    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onEvent(data);

            // Auto-close on terminal events
            if (data.stage === 'completed' || data.stage === 'failed') {
                eventSource.close();
            }
        } catch (e) {
            console.warn('Failed to parse SSE event:', e);
        }
    };

    eventSource.onerror = (err) => {
        console.error('SSE connection error:', err);
        if (onError) onError(err);
        eventSource.close();
    };

    // Return cleanup function
    return () => {
        eventSource.close();
    };
};

// ============== Background Jobs API ==============

/**
 * Submit a heavy AI task to run in background.
 * Returns immediately with a job_id - UI never blocks.
 * 
 * @param {string} jobType - Type of job: 'generate_mcq', 'generate_notes', 'generate_mindmap', 'generate_flashcards'
 * @param {Object} metadata - Job-specific metadata
 * @returns {Object} { job_id, status, created_at }
 */
export const submitBackgroundJob = async (jobType, metadata = {}) => {
    const response = await api.post('/jobs/submit', {
        job_type: jobType,
        metadata
    });
    return response.data;
};

/**
 * Get the status of a background job.
 * @param {string} jobId - The job ID from submitBackgroundJob
 * @returns {Object} Job status with progress, result, or error
 */
export const getJobStatus = async (jobId) => {
    const response = await api.get(`/jobs/status/${jobId}`);
    return response.data;
};

/**
 * Lightweight polling for job status.
 * Use this for frequent polling (every 1-2 seconds).
 * @param {string} jobId - The job ID
 * @returns {Object} { job_id, status, progress, completed }
 */
export const pollJobStatus = async (jobId) => {
    const response = await api.get(`/jobs/status/${jobId}/poll`);
    return response.data;
};

/**
 * Get all background jobs for current user.
 * @param {number} limit - Max number of jobs to return
 * @returns {Array} List of user's jobs
 */
export const getMyJobs = async (limit = 10) => {
    const response = await api.get('/jobs/my-jobs', { params: { limit } });
    return response.data;
};

/**
 * Poll for job completion with automatic cleanup.
 * Returns when job completes or fails.
 * 
 * @param {string} jobId - The job ID
 * @param {Object} options - { onProgress, interval, timeout }
 * @returns {Object} Job result when completed
 */
export const waitForJob = async (jobId, options = {}) => {
    const { 
        onProgress, 
        interval = 2000,  // Poll every 2 seconds
        timeout = 120000  // 2 minute timeout
    } = options;
    
    const startTime = Date.now();
    
    while (true) {
        // Check timeout
        if (Date.now() - startTime > timeout) {
            throw new Error('Job polling timeout');
        }
        
        const status = await pollJobStatus(jobId);
        
        if (onProgress) {
            onProgress(status);
        }
        
        if (status.completed) {
            // Get full result
            return await getJobStatus(jobId);
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, interval));
    }
};
