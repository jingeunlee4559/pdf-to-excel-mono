import api, { API_BASE } from "./axios";

export const createDocumentJobApi = async ({ title, userRequest, outputMode, templateId, files }) => {
  const formData = new FormData();
  formData.append('title', title || '문서 분석 작업');
  formData.append('userRequest', userRequest || '문서를 분석해서 표로 만들어줘');
  formData.append('outputMode', outputMode || 'FREE_FORM');
  if (templateId) formData.append('templateId', templateId);
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

export const generateExcelApi = async (jobId, payload = {}) => {
  const { data } = await api.post(`/document-jobs/${jobId}/excels`, payload);
  return data;
};

export const sendAiChatApi = async ({ message, context }) => {
  const { data } = await api.post('/document-jobs/chat', {
    message: message || '',
    context: context || {}
  });
  return data;
};

export const excelDownloadUrl = (jobId, excelId) => {
  const base = API_BASE;
  const token = localStorage.getItem('accessToken');
  return `${base}/document-jobs/${jobId}/excels/${excelId}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
};
