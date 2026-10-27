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
