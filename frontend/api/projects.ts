import {request} from './client';
export type Project={id:string;channelId:string;ownerId:string;name:string;topic:string;targetLanguage:string;targetDurationSec?:number|null;status:string;currentStage?:string|null;budgetCents?:number|null;createdAt:string;updatedAt:string};
export const projectsApi={list:()=>request<Project[]>('/projects'),get:(id:string)=>request<Project>(`/projects/${id}`),create:(body:Pick<Project,'name'|'topic'|'targetLanguage'> & Partial<Project>)=>request<Project>('/projects',{method:'POST',body:JSON.stringify(body)})};
