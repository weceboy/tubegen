import {request} from './client';
export type Job={id:string;projectId:string;type:string;status:'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED';progress?:number|null;errorMessage?:string|null;startedAt?:string|null;finishedAt?:string|null;createdAt:string};
export const jobsApi={list:(projectId?:string)=>request<Job[]>(projectId?`/projects/${projectId}/jobs`:'/jobs'),get:(id:string)=>request<Job>(`/jobs/${id}`)};
export type JobEvent={type:'job.created'|'job.started'|'job.progress'|'job.completed'|'job.failed'|'project.stage.changed'|'approval.created'|'approval.approved'|'approval.rejected';jobId?:string;projectId?:string;payload?:unknown};
export function subscribeToJobEvents(onEvent:(event:JobEvent)=>void){const url=process.env.NEXT_PUBLIC_EVENTS_URL;if(!url||typeof EventSource==='undefined')return ()=>{};const source=new EventSource(url,{withCredentials:true});source.onmessage=e=>{try{onEvent(JSON.parse(e.data))}catch{}};return ()=>source.close()}
