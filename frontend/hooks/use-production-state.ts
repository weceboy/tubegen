"use client";import {useQuery} from '@tanstack/react-query';import {jobsApi} from '../api/jobs';import {projectsApi} from '../api/projects';import {scenesApi} from '../api/scenes';
export function useProject(id:string){return useQuery({queryKey:['project',id],queryFn:()=>projectsApi.get(id),enabled:!!id,refetchInterval:15000})}
export function useProjectScenes(id:string){return useQuery({queryKey:['project',id,'scenes'],queryFn:()=>scenesApi.list(id),enabled:!!id,refetchInterval:15000})}
export function useJobs(projectId?:string){return useQuery({queryKey:['jobs',projectId||'all'],queryFn:()=>jobsApi.list(projectId),refetchInterval:jobList=>jobList.state.data?.some(j=>j.status==='RUNNING'||j.status==='QUEUED')?3000:false})}
