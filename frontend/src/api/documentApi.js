import api, { API_BASE } from "./axios";

export const createDocumentJobApi = async ({ title, userRequest, outputMode, templateId, files, chatSessionId }) => {
  const formData = new FormData();
  formData.append('title', title || '문서 분석 작업');
  formData.append('userRequest', userRequest || '문서를 분석해서 표로 만들어줘');
  formData.append('outputMode', outputMode || 'FREE_FORM');
  if (templateId) formData.append('templateId', templateId);
  if (chatSessionId) formData.append('chatSessionId', chatSessionId);
  Array.from(files || []).forEach((file) => formData.append('files', file));

  const { data } = await api.post('/document-jobs', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
};

export const listDocumentJobsApi = async () => {
  const { data } = await api.get('/document-jobs');
  return data;
};

export const getDocumentJobApi = async (jobId) => {
  const { data } = await api.get(`/document-jobs/${jobId}`);
  return data;
};

export const updateTableApi = async (jobId, table) => {
  const { data } = await api.put(`/document-jobs/${jobId}/table`, table);
  return data;
};

export const revalidateJobApi = async (jobId) => {
  const { data } = await api.post(`/document-jobs/${jobId}/revalidate`);
  return data;
};


export const createAiTemplateApi = async (jobId, payload = {}) => {
  const { data } = await api.post(`/document-jobs/${jobId}/ai-template`, payload);
  return data;
};

export const updateCandidateFieldApi = async (jobId, fieldId, payload = {}) => {
  const { data } = await api.post(`/document-jobs/${jobId}/candidate-fields/${fieldId}`, payload);
  return data;
};

export const generateExcelApi = async (jobId, payload = {}) => {
  const { data } = await api.post(`/document-jobs/${jobId}/excels`, payload);
  return data;
};

export const getExcelPreviewApi = async (jobId, excelId) => {
  const { data } = await api.get(`/document-jobs/${jobId}/excels/${excelId}/preview`);
  return data;
};

// 저장 없이 미리보기용 임시 엑셀 생성 (색상/스타일 포함)
export const generateExcelPreviewOnlyApi = async (jobId, payload = {}) => {
  const { data } = await api.post(`/document-jobs/${jobId}/excel-preview`, payload);
  return data;
};

export const sendAiChatApi = async ({ message, context, sessionId, jobId, tableId }) => {
  const { data } = await api.post('/document-jobs/chat', {
    message: message || '',
    context: context || {},
    sessionId: sessionId || null,
    jobId: jobId || null,
    tableId: tableId || null
  });
  return data;
};

export const listChatSessionsApi = async () => {
  const { data } = await api.get('/document-jobs/chats');
  return data;
};

export const createChatSessionApi = async (payload = {}) => {
  const { data } = await api.post('/document-jobs/chats', payload);
  return data;
};

export const getChatSessionApi = async (sessionId) => {
  const { data } = await api.get(`/document-jobs/chats/${sessionId}`);
  return data;
};

export const deleteChatSessionApi = async (sessionId) => {
  const { data } = await api.delete(`/document-jobs/chats/${sessionId}`);
  return data;
};

export const listDownloadsApi = async () => {
  const { data } = await api.get('/document-jobs/downloads');
  return data;
};

export const excelDownloadUrl = (jobId, excelId) => {
  const base = API_BASE;
  const token = localStorage.getItem('accessToken');
  return `${base}/document-jobs/${jobId}/excels/${excelId}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
};
