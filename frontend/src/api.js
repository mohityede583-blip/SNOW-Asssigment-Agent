import axios from 'axios';

const api = axios.create({
  baseURL: '', // Empty because Vite proxy handles routing `/api` to port 8000
});

export const getIncidents = async (status = null) => {
  const url = status ? `/api/incidents?status=${status}` : '/api/incidents';
  const response = await api.get(url);
  return response.data;
};

export const simulateIncident = async () => {
  const response = await api.post('/api/incidents/simulate');
  return response.data;
};

export const assignIncidents = async (incidentNumbers) => {
  const response = await api.post('/api/incidents/assign', { incident_numbers: incidentNumbers });
  return response.data;
};

export const approveAssignment = async (incidentNumber, associateName) => {
  const response = await api.post('/api/incidents/approve', {
    incident_number: incidentNumber,
    associate_name: associateName,
  });
  return response.data;
};

export const rejectAssignment = async (incidentNumber, associateName) => {
  const response = await api.post('/api/incidents/reject', {
    incident_number: incidentNumber,
    associate_name: associateName,
  });
  return response.data;
};

export const overrideAssignment = async (incidentNumber, associateName) => {
  const response = await api.post('/api/incidents/override', {
    incident_number: incidentNumber,
    associate_name: associateName,
  });
  return response.data;
};

export const resolveIncident = async (incidentNumber, resolution, resolvedBy) => {
  const response = await api.post('/api/incidents/resolve', {
    incident_number: incidentNumber,
    resolution,
    resolved_by: resolvedBy,
  });
  return response.data;
};

export const getAssociates = async () => {
  const response = await api.get('/api/associates');
  return response.data;
};

export const getRoster = async () => {
  const response = await api.get('/api/roster');
  return response.data;
};

export const getLogs = async (incidentNumber = null) => {
  const url = incidentNumber ? `/api/logs?incident_number=${incidentNumber}` : '/api/logs';
  const response = await api.get(url);
  return response.data;
};

export const getHistory = async () => {
  const response = await api.get('/api/history');
  return response.data;
};

export const searchHistory = async (query) => {
  const response = await api.get(`/api/history/search?query=${encodeURIComponent(query)}`);
  return response.data;
};

export const getMetrics = async () => {
  const response = await api.get('/api/metrics');
  return response.data;
};

export const getIncidentDetails = async (number) => {
  const response = await api.get(`/api/incidents/${number}`);
  return response.data;
};

export const getSimilarIncidents = async (number, topK = 3) => {
  const response = await api.get(`/api/incidents/${number}/similar?top_k=${topK}`);
  return response.data;
};
