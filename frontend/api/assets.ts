import {request} from './client';
export type Asset={id:string;generationAttemptId?:string|null;type:string;source:string;provider?:string|null;storageKey:string;mimeType?:string|null;width?:number|null;height?:number|null;durationMs?:number|null;licenseStatus?:string|null;selected:boolean;status:string;createdAt:string};
export const assetsApi={list:()=>request<Asset[]>('/assets'),get:(id:string)=>request<Asset>(`/assets/${id}`)};
