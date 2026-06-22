import api from "./axios";


export const loginApi = async ({ loginId, password }) => {
  const { data } = await api.post('/auth/login', { loginId, password });
  return data;
};

export const registerApi = async (payload) => {
  const { data } = await api.post('/auth/register', payload);
  return data;
};

export const meApi = async () => {
  const { data } = await api.get('/auth/me');
  return data;
};
