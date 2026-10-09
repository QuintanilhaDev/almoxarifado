export const REALTIME_CHANNEL = 'almoxarifado';
export type RealtimeEvent =
  | 'request:new'
  | 'request:update'
  | 'form:update'
  | 'emails:update'
  | 'admins:update'
  | 'stock:update'
  | 'postos:update';
