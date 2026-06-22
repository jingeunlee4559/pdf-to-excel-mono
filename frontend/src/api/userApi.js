import api from './axios';

export const listUsersApi = async () => {
  const { data } = await api.get('/users');
  return data;
};
