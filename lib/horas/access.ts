import { hasLevel, type HubUser } from '../permissions';

/** aba Horas extras do RH: quem tem o módulo (o master do RH e o master geral sempre têm) */
export const canHoras = (user: HubUser | null | undefined) => hasLevel(user, 'rh', 'horas_extras', 'view');
