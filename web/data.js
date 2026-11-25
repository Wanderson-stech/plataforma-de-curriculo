export const models = ['Remoto', 'Híbrido', 'Presencial'];
export const levels = ['Estágio', 'Júnior', 'Pleno', 'Sênior'];
export const stages = [
  ['saved', 'Salvas'],
  ['applied', 'Candidatado'],
  ['interview', 'Em entrevista'],
  ['finished', 'Finalizadas']
];

export function initialData() {
  return {
    jobs: [], applications: [], resumeId: null, resumes: {},
    profile: {
      name: '', role: '', location: '', email: '', portfolio: '',
      summary: '', goal: '', projects: '', certifications: '', languages: '',
      documents: '', formation: '', skills: '', experiences: []
    },
    alerts: {
      active: false, roles: [], models: [], levels: [], minimum: 0, inApp: true
    }
  };
}
