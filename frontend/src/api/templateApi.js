import api from "./axios";


export const listTemplatesApi = async () => {
  const { data } = await api.get('/templates');
  return data;
};

export const createTemplateApi = async ({ templateName, templateCode, templateType, description, file, mappingJson }) => {
  const formData = new FormData();
  formData.append('templateName', templateName);
  if (templateCode) formData.append('templateCode', templateCode);
  formData.append('templateType', templateType || 'NORMAL_TABLE');
  formData.append('description', description || '');
  formData.append('mappingJson', mappingJson || '{}');
  if (file) formData.append('file', file);

  const { data } = await api.post('/templates', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
};

export const getTemplatePreviewApi = async (templateId, params = {}) => {
  const { data } = await api.get(`/templates/${templateId}/preview`, { params });
  return data;
};

export const getTemplateMappingsApi = async (templateId) => {
  const { data } = await api.get(`/templates/${templateId}/mappings`);
  return data;
};

export const saveTemplateMappingsApi = async (templateId, payload) => {
  const { data } = await api.put(`/templates/${templateId}/mappings`, payload);
  return data;
};

export const listStandardFieldsApi = async (params = {}) => {
  const { data } = await api.get('/references/standard-fields', { params });
  return data;
};
