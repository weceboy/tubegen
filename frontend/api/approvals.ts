import {request} from './client';
export type Approval={id:string;projectId:string;userId:string;artifactId?:string|null;stage:string;status:string;comment?:string|null;createdAt:string;decidedAt?:string|null};
export const approvalsApi={list:(projectId:string)=>request<Approval[]>(`/projects/${projectId}/approvals`),approve:(id:string)=>request<Approval>(`/approvals/${id}/approve`,{method:'POST'}),reject:(id:string,comment:string)=>request<Approval>(`/approvals/${id}/reject`,{method:'POST',body:JSON.stringify({comment})})};
