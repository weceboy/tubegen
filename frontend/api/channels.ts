import {request} from './client';
export type Channel={id:string;ownerId:string;name:string;handle?:string|null;language:string;niche?:string|null;timezone:string;brandConfig?:unknown;automationConfig?:unknown;youtubeChannelId?:string|null;createdAt:string;updatedAt:string};
export const channelsApi={list:()=>request<Channel[]>('/channels'),get:(id:string)=>request<Channel>(`/channels/${id}`),update:(id:string,body:Partial<Channel>)=>request<Channel>(`/channels/${id}`,{method:'PATCH',body:JSON.stringify(body)})};
