import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ReportPage from './page';
import { apiClient } from '@/lib/api';
vi.mock('next/navigation',()=>({useParams:()=>({id:'open-session'})}));
vi.mock('@/lib/api',()=>({apiClient:{getSession:vi.fn(),getSessionReport:vi.fn(),getSimulation:vi.fn()},ApiError:class extends Error{}}));
it('explains open conversations without requesting a scored report',async()=>{
 vi.mocked(apiClient.getSession).mockResolvedValue({assessment_mode:'open',id:'open-session',simulation_slug:'custom',created_at:'',updated_at:'',messages:[],goal_progress:[],analysis:{},session_config:{starts_conversation:false,typing_speed_wpm:null,inactivity_nudge_delay_sec:null,max_inactivity_nudges:null,burstiness:null}});
 render(<ReportPage/>);
 expect(await screen.findByText('Open conversation')).toBeInTheDocument();
 expect(apiClient.getSessionReport).not.toHaveBeenCalled();
});

it('keeps the participant report, highlighted quotes and chat navigation after sharing its presentation', async () => {
 const session = { assessment_mode:'practice' as const,id:'session',simulation_slug:'custom',simulation_title:'Practice',created_at:'',updated_at:'',messages:[{id:'message',role:'human' as const,content:'A thoughtful introduction.',order_index:0,created_at:'',source:'text' as const,typing_delay_ms:null}],goal_progress:[],analysis:{},session_config:{starts_conversation:false,typing_speed_wpm:null,inactivity_nudge_delay_sec:null,max_inactivity_nudges:null,burstiness:null}};
 vi.mocked(apiClient.getSession).mockResolvedValue(session);
 vi.mocked(apiClient.getSimulation).mockRejectedValue(new Error('Metadata unavailable'));
 vi.mocked(apiClient.getSessionReport).mockResolvedValue({session_id:'session',simulation_slug:'custom',message_count:1,cached:true,report:{version:1,generated_at:'2026-10-30T12:00:00Z',overall_score:80,skills:[{key:'clarity',score:80,rationale:'Clear opening.'}],goal_outcome:null,stats:{message_count:1,user_message_count:1,ai_message_count:0,user_word_count:3,ai_word_count:0},emotional_tone:{overall:'composed',journey:[]},summary:'Shared presentation still works.',strengths:['Clear opening'],improvement_areas:[],advice:[],key_moments:[{message_index:0,role:'human',label:'Opening',note:'Strong start.'}],voice:null}});
 render(<ReportPage/>);
 expect(await screen.findByText('Shared presentation still works.')).toBeVisible();
 expect(screen.getByText(/A thoughtful introduction/)).toBeVisible();
 expect(screen.getAllByRole('link',{name:'Back to chat'})).toHaveLength(2);
 expect(screen.getByRole('heading',{name:'Skill scores'})).toBeVisible();
});
