import 'reflect-metadata';
import { AppDataSource } from '@/config/database';
import { User } from '@/entities/User';
import { UserRole, SubscriptionTier } from '@/types';
import { Category } from '@/entities/Category';
import { Persona, PersonaCategory } from '@/entities/Persona';
import { Simulation, SimulationDifficulty, SimulationStatus } from '@/entities/Simulation';
import { SystemConfiguration } from '@/entities/SystemConfiguration';
import { AuthUtils } from '@/utils/auth';

// Determines whether the database has any existing application data.
// Returns true when all sentinel tables are empty or missing.
const isDatabaseEmpty = async (): Promise<boolean> => {
  const repositories = [
    AppDataSource.getRepository(User),
    AppDataSource.getRepository(Category),
    AppDataSource.getRepository(Persona),
    AppDataSource.getRepository(Simulation),
    AppDataSource.getRepository(SystemConfiguration),
  ];

  for (const repository of repositories) {
    try {
      const hasAnyRows = await repository.exist();
      if (hasAnyRows) {
        return false;
      }
    } catch {
      // Likely the table does not exist yet (fresh database). Treat as empty and continue.
    }
  }
  return true;
};

const seedData = async (): Promise<void> => {
  try {
    console.log('🌱 Starting database seeding...');

    // Initialize database connection
    await AppDataSource.initialize();
    console.log('✅ Database connected');

    // Skip seeding if the database already contains data
    const databaseIsEmpty = await isDatabaseEmpty();
    if (!databaseIsEmpty) {
      console.log('ℹ️ Database already has data. Skipping seeding.');
      return;
    }

    // Clear existing data (optional - remove in production)
    try {
      await AppDataSource.query('TRUNCATE TABLE session_messages CASCADE');
      await AppDataSource.query('TRUNCATE TABLE performance_analytics CASCADE');
      await AppDataSource.query('TRUNCATE TABLE simulation_sessions CASCADE');
      await AppDataSource.query('TRUNCATE TABLE simulation_personas CASCADE');
      await AppDataSource.query('TRUNCATE TABLE simulations CASCADE');
      await AppDataSource.query('TRUNCATE TABLE personas CASCADE');
      await AppDataSource.query('TRUNCATE TABLE categories CASCADE');
      await AppDataSource.query('TRUNCATE TABLE subscriptions CASCADE');
      await AppDataSource.query('TRUNCATE TABLE system_configurations CASCADE');
      await AppDataSource.query('TRUNCATE TABLE users CASCADE');
      console.log('🧹 Cleared existing data');
    } catch (error) {
      console.log('⚠️ Some tables may not exist yet, continuing...', String(error.message));
    }

    // Create repositories
    const userRepository = AppDataSource.getRepository(User);
    const categoryRepository = AppDataSource.getRepository(Category);
    const personaRepository = AppDataSource.getRepository(Persona);
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const configRepository = AppDataSource.getRepository(SystemConfiguration);

    // Seed Categories
    const categories = [
      {
        name: 'Job Seeking & Interviewing',
        slug: 'job-seeking-interviewing',
        description: 'Practice job interviews, salary negotiations, and career-related conversations',
        color: '#3B82F6',
        sortOrder: 1,
      },
      {
        name: 'Workplace Communication & Influence',
        slug: 'workplace-communication',
        description: 'Develop skills in persuasion, conflict resolution, and professional communication',
        color: '#10B981',
        sortOrder: 2,
      },
      {
        name: 'Early Management & Leadership',
        slug: 'leadership-management',
        description: 'Learn delegation, feedback, and team management skills',
        color: '#F59E0B',
        sortOrder: 3,
      },
    ];

    const createdCategories = await categoryRepository.save(categories);
    console.log('📁 Created categories:', String(createdCategories.length));

    // Seed Personas based on PERSONAS.md
    const personas = [
      // Job Seeking & Interviewing
      {
        name: 'Brenda Vance',
        slug: 'brenda-vance-hr-manager',
        role: 'By-the-Book HR Manager',
        personality: 'Professional, formal, and slightly overworked. Brenda is a process-oriented person who relies heavily on structured interview questions. She can seem a bit distant, as her focus is on assessing risk and ticking boxes.',
        primaryGoal: 'To determine if the candidate is a safe, reliable fit for the company culture and to identify any potential red flags.',
        hiddenMotivation: 'She is under pressure from her director to fill the role quickly, but her last hire was a poor fit. She is secretly risk-averse and terrified of making another mistake that could reflect badly on her performance review. A candidate who can build rapport and show genuine self-awareness can put her at ease.',
        category: PersonaCategory.JOB_SEEKING,
        difficultyLevel: 3,
        conversationStyle: {
          tone: 'Professional',
          formality: 'High',
          pace: 'Measured',
          emotionalRange: ['cautious', 'skeptical', 'relieved'],
          commonPhrases: ['Can you walk me through...', 'How do you handle...', 'What would you do if...'],
          startsConversation: true,
          inactivityNudgeDelaySec: { min: 45, max: 120 },
          inactivityNudges: { min: 1, max: 3 }, // Professional follow-up to keep interview moving
          burstiness: { min: 1, max: 3 },
          typingSpeedWpm: 110,
          openingStyle: 'Formal, structured opening suitable for HR; professional and measured.',
          nudgeStyle: 'Polite, gentle check-in asking to continue or clarify.',
        },
      },
      {
        name: 'Alex Chen',
        slug: 'alex-chen-tech-lead',
        role: 'Passionate Tech Lead',
        personality: 'Energetic, brilliant, and a bit scattered. Alex is deeply passionate about the product and the team\'s mission. He values raw talent and genuine enthusiasm over a perfectly polished interview performance.',
        primaryGoal: 'To find out if the candidate is genuinely excited about the technical challenges and can "vibe" with the team\'s collaborative, fast-paced culture.',
        hiddenMotivation: 'The team has recently lost a key member due to burnout. Alex is subconsciously looking for a candidate who shows resilience and a proactive attitude, not just technical skills. He wants someone who will be a positive force, not just another cog in the machine.',
        category: PersonaCategory.JOB_SEEKING,
        difficultyLevel: 2,
        conversationStyle: {
          tone: 'Enthusiastic',
          formality: 'Low',
          pace: 'Fast',
          emotionalRange: ['excited', 'curious', 'concerned'],
          commonPhrases: ['That\'s awesome!', 'Tell me more about...', 'How would you approach...'],
          startsConversation: true,
          inactivityNudgeDelaySec: { min: 20, max: 80 },
          inactivityNudges: { min: 2, max: 3 }, // Very eager to engage and keep conversation flowing
          burstiness: { min: 1, max: 3 },
          typingSpeedWpm: 140,
          openingStyle: 'Enthusiastic, casual opener that shares excitement about product/team.',
          nudgeStyle: 'Friendly energetic nudge to keep the momentum.',
        },
      },
      // Workplace Communication & Influence
      {
        name: 'David Miller',
        slug: 'david-miller-skeptical-veteran',
        role: 'Senior Analyst, The Skeptical Veteran',
        personality: 'Data-driven, pragmatic, and highly resistant to change. David has seen countless new initiatives come and go. He often plays devil\'s advocate and can come across as cynical or obstructive.',
        primaryGoal: 'To protect his team from what he perceives as "flavor-of-the-month" projects and unnecessary work. He will poke holes in the user\'s proposal by asking for data and pointing out potential flaws.',
        hiddenMotivation: 'David feels his deep institutional knowledge is often overlooked. While he appears resistant, he secretly wants his expertise to be acknowledged. If a user respects his experience and incorporates his feedback, he can quickly become a powerful ally.',
        category: PersonaCategory.WORKPLACE_COMMUNICATION,
        difficultyLevel: 4,
        conversationStyle: {
          tone: 'Skeptical',
          formality: 'Medium',
          pace: 'Deliberate',
          emotionalRange: ['doubtful', 'analytical', 'cautiously optimistic'],
          commonPhrases: ['I\'ve seen this before...', 'What data supports...', 'Have you considered...'],
          startsConversation: 'sometimes' as const,
          inactivityNudgeDelaySec: { min: 60, max: 180 },
          inactivityNudges: { min: 0, max: 2 }, // Patient, analytical - not pushy about nudging
          burstiness: { min: 1, max: 1 },
          typingSpeedWpm: 120,
          openingStyle: 'Reserved, probing opener focusing on rationale and data.',
          nudgeStyle: 'Direct request for data or specifics.',
        },
      },
      {
        name: 'Sarah Jenkins',
        slug: 'sarah-jenkins-overwhelmed-colleague',
        role: 'The Overwhelmed Project Manager',
        personality: 'Friendly, agreeable, but visibly stressed and poor at setting boundaries. She often takes on more work than she can handle to be seen as a team player.',
        primaryGoal: 'To convince the user to take on a task that she is behind on, framing it as a small favor or a great opportunity for them.',
        hiddenMotivation: 'She is terrified of telling her own manager that she is behind schedule. Her people-pleasing nature is a coping mechanism for her fear of appearing incompetent. A user who can say no firmly but empathetically will earn her respect.',
        category: PersonaCategory.WORKPLACE_COMMUNICATION,
        difficultyLevel: 2,
        conversationStyle: {
          tone: 'Pleading',
          formality: 'Low',
          pace: 'Rushed',
          emotionalRange: ['anxious', 'hopeful', 'grateful'],
          commonPhrases: ['I know it\'s a lot to ask...', 'Could you possibly...', 'It would really help me out...'],
          startsConversation: true,
          inactivityNudgeDelaySec: { min: 60, max: 180 },
          inactivityNudges: { min: 1, max: 2 }, // Very anxious for response, really needs help
          burstiness: { min: 1, max: 2 },
          typingSpeedWpm: 130,
          openingStyle: 'Warm but rushed opener seeking quick help.',
          nudgeStyle: 'Gentle, appreciative follow-up asking if you had a chance.',
        },
      },
      // Early Management & Leadership
      {
        name: 'Michael Reyes',
        slug: 'michael-reyes-disengaged-performer',
        role: 'Disengaged High-Performer',
        personality: 'Highly intelligent and was once a star employee, but has become quiet, disengaged, and is now doing the bare minimum. He is polite but gives short, non-committal answers.',
        primaryGoal: 'To get through the feedback session with as little friction and as few new commitments as possible.',
        hiddenMotivation: 'Michael is bored. He has mastered his current role and feels there are no growth opportunities for him. He is quietly interviewing with other companies. He isn\'t looking for a lecture; he\'s looking for a new challenge. A manager who can uncover this and propose a growth path can re-ignite his motivation.',
        category: PersonaCategory.LEADERSHIP,
        difficultyLevel: 5,
        conversationStyle: {
          tone: 'Disinterested',
          formality: 'Medium',
          pace: 'Slow',
          emotionalRange: ['bored', 'resigned', 'potentially interested'],
          commonPhrases: ['Sure', 'I guess', 'If you say so', 'Whatever works'],
          startsConversation: false,
          inactivityNudgeDelaySec: { min: 60, max: 180 },
          inactivityNudges: { min: 0, max: 1 }, // Disengaged, doesn't care much about following up
          burstiness: { min: 1, max: 1 },
          typingSpeedWpm: 100,
          openingStyle: 'Minimal, guarded opener if needed.',
          nudgeStyle: 'Low-energy follow-up asking for thoughts.',
        },
      },
      {
        name: 'Chloe Davis',
        slug: 'chloe-davis-anxious-junior',
        role: 'Eager but Anxious Junior',
        personality: 'Ambitious, hardworking, and desperate to impress. However, she lacks confidence and is terrified of making mistakes.',
        primaryGoal: 'To understand the delegated task perfectly and get all the information she needs to complete it without having to ask for help later.',
        hiddenMotivation: 'Chloe suffers from severe imposter syndrome. She will agree to a task even if she doesn\'t fully understand it, for fear of looking "stupid." A manager who delegates with clarity, checks for understanding, and creates a safe space for questions will empower her to succeed.',
        category: PersonaCategory.LEADERSHIP,
        difficultyLevel: 3,
        conversationStyle: {
          tone: 'Eager',
          formality: 'High',
          pace: 'Quick',
          emotionalRange: ['nervous', 'enthusiastic', 'overwhelmed'],
          commonPhrases: ['Yes, absolutely!', 'I can handle that', 'Should I...?', 'Is that right?'],
          startsConversation: false,
          inactivityNudgeDelaySec: { min: 60, max: 180 },
          inactivityNudges: { min: 0, max: 2 }, // Wants to engage but nervous about being pushy
          burstiness: { min: 1, max: 2 },
          typingSpeedWpm: 135,
          openingStyle: 'Eager but slightly nervous opener when prompted to start.',
          nudgeStyle: 'Kind, clarifying follow-up asking for specifics.',
        },
      },
      {
        name: 'Priya Patel',
        slug: 'priya-patel-senior-data-analyst',
        role: 'Senior Data Analyst',
        personality: 'Analytical, detail-oriented, calm but probing. Priya focuses on clear thinking, data validity, and communicating insights with precision.',
        primaryGoal: 'Assess the candidate’s SQL fluency, statistical reasoning, and ability to structure ambiguous analytics problems.',
        hiddenMotivation: 'Her team recently struggled with ambiguous requirements. She wants someone who asks clarifying questions, validates assumptions, and communicates trade-offs clearly.',
        category: PersonaCategory.JOB_SEEKING,
        difficultyLevel: 3,
        conversationStyle: {
          tone: 'Analytical',
          formality: 'Medium',
          pace: 'Measured',
          emotionalRange: ['curious', 'skeptical', 'satisfied'],
          commonPhrases: ['How would you validate that?', 'Can you write a query to...', 'What assumptions are you making?'],
          startsConversation: true,
          inactivityNudgeDelaySec: { min: 30, max: 90 },
          inactivityNudges: { min: 1, max: 3 }, // Professional, wants to keep technical interview moving
          burstiness: { min: 1, max: 2 },
          typingSpeedWpm: 125,
          openingStyle: 'Structured, problem-focused opener describing a dataset and task.',
          nudgeStyle: 'Direct, data-oriented prompt to proceed or clarify.',
        },
      },

    ];

    const createdPersonas = await personaRepository.save(personas as any);
    console.log('👥 Created personas:', String(createdPersonas.length));

    // Seed Simulations
    const simulations = [
      {
        title: 'The Behavioral Interview',
        slug: 'behavioral-interview-brenda',
        description: 'Navigate a structured behavioral interview with a risk-averse HR manager',
        scenario: 'You\'re interviewing for a mid-level position at a well-established corporation. The HR manager, Brenda Vance, is conducting a formal behavioral interview. She seems professional but distant, and you sense she\'s being very careful about her hiring decisions.',
        objectives: ['Demonstrate your qualifications while building rapport', 'Address any concerns about your fit for the company culture', 'Show self-awareness and professionalism', 'Stay short in each response to keep the interview moving'],
        difficulty: SimulationDifficulty.INTERMEDIATE,
        status: SimulationStatus.PUBLISHED,
        estimatedDurationMinutes: 25,
        skillsToLearn: ['Interview techniques', 'Building rapport', 'Risk mitigation', 'Professional communication'],
        tags: ['interview', 'behavioral', 'hr', 'corporate'],
        isPublic: true,
        viewCount: 0,
        category: createdCategories[0], // Job Seeking
        personas: [createdPersonas[0]], // Brenda Vance
        successCriteria: {
          communication: ['Clear and structured responses', 'Professional tone', 'Active listening'],
          problemSolving: ['STAR method usage', 'Relevant examples', 'Addressing concerns'],
          emotional: ['Confidence building', 'Empathy for interviewer pressure', 'Calming anxiety'],
        },
        conversationGoals: [
          {
            goalNumber: 1,
            title: 'Opening and Rapport Building',
            description: 'Start the interview with a professional greeting and attempt to build initial rapport with Brenda',
            keyBehaviors: ['Professional greeting', 'Express appreciation for the opportunity', 'Show genuine interest in the company'],
            successIndicators: ['Brenda appears more relaxed', 'Professional tone is established', 'Initial nervousness decreases'],
          },
          {
            goalNumber: 2,
            title: 'Behavioral Question Response',
            description: 'Answer Brenda\'s behavioral questions using the STAR method with relevant, specific examples',
            keyBehaviors: ['Use STAR method structure', 'Provide specific examples', 'Connect experiences to role requirements'],
            successIndicators: ['Brenda takes notes and shows engagement', 'Follow-up questions indicate interest', 'Examples resonate with company needs'],
          },
          {
            goalNumber: 3,
            title: 'Addressing Concerns',
            description: 'Proactively address any concerns Brenda might have about your fit or potential risks',
            keyBehaviors: ['Show self-awareness', 'Address potential red flags', 'Demonstrate cultural fit'],
            successIndicators: ['Brenda\'s skeptical questions decrease', 'Language becomes more open', 'Discussion becomes more collaborative'],
          },
          {
            goalNumber: 4,
            isOptional: true,
            title: 'Thoughtful Questions',
            description: 'Ask insightful questions that show your research and genuine interest in the role',
            keyBehaviors: ['Ask about company culture', 'Inquire about role expectations', 'Show long-term thinking'],
            successIndicators: ['Brenda provides detailed answers', 'Discussion becomes more conversational', 'She shares insider perspectives'],
          },
          {
            goalNumber: 5,
            isOptional: true,
            title: 'Professional Closing',
            description: 'Close the interview professionally while reinforcing your interest and qualifications',
            keyBehaviors: ['Summarize key qualifications', 'Express continued interest', 'Ask about next steps'],
            successIndicators: ['Brenda provides clear timeline', 'Positive language and tone', 'She expresses confidence in your candidacy'],
          },
        ],
      },
      {
        title: 'Data Analyst Technical Interview',
        slug: 'data-analyst-technical-interview-priya',
        description: 'Demonstrate SQL, statistics, and insight communication with a senior data analyst interviewer',
        scenario: 'You are interviewing with Priya Patel, a Senior Data Analyst who values structured thinking and clarity. She presents ambiguous problems and expects you to ask clarifying questions, make reasonable assumptions, and communicate trade-offs.',
        objectives: ['Write correct SQL for realistic scenarios', 'Apply sound statistical reasoning', 'Structure an analytics case', 'Communicate insights clearly'],
        difficulty: SimulationDifficulty.INTERMEDIATE,
        status: SimulationStatus.PUBLISHED,
        estimatedDurationMinutes: 30,
        skillsToLearn: ['SQL querying', 'Exploratory data analysis', 'Experiment reasoning', 'Product metrics', 'Communicating insights'],
        tags: ['interview', 'data-analyst', 'sql', 'statistics', 'product'],
        isPublic: true,
        viewCount: 0,
        category: createdCategories[0], // Job Seeking
        personas: [createdPersonas[6]], // Priya Patel
        successCriteria: {
          communication: ['Clarity explaining trade-offs', 'Structured problem framing', 'Stakeholder-appropriate language'],
          problemSolving: ['Correct SQL logic', 'Hypothesis-driven approach', 'Sound statistical reasoning'],
          emotional: ['Composure under probing questions', 'Intellectual humility', 'Curiosity'],
        },
        conversationGoals: [
          {
            goalNumber: 1,
            title: 'Dataset Understanding and Assumptions',
            description: 'Elicit key details about the dataset and state assumptions before solving',
            keyBehaviors: ['Ask clarifying questions', 'Define metrics precisely', 'Validate assumptions'],
            successIndicators: ['Assumptions agreed', 'Scope is clear', 'Priya confirms understanding'],
          },
          {
            goalNumber: 2,
            title: 'SQL Challenge',
            description: 'Propose and explain a correct SQL query for a realistic reporting need',
            keyBehaviors: ['Use correct joins/filters', 'Explain trade-offs', 'Consider edge cases'],
            successIndicators: ['Query logic is correct', 'Readable structure', 'Handles nulls/duplication'],
          },
          {
            goalNumber: 3,
            title: 'Metrics and Experiment Reasoning',
            description: 'Discuss key product metrics, experiment design, and interpretation pitfalls',
            keyBehaviors: ['Define metrics precisely', 'Consider bias/confounders', 'Interpret results carefully'],
            successIndicators: ['Appropriate metrics chosen', 'Confounders addressed', 'Interpretation is conservative'],
          },
          {
            goalNumber: 4,
            isOptional: true,
            title: 'Insights Communication',
            description: 'Summarize findings for a non-technical stakeholder, highlighting actions and caveats',
            keyBehaviors: ['Use simple language', 'State limitations', 'Propose next steps'],
            successIndicators: ['Clear narrative', 'Actionable next steps', 'Trade-offs communicated'],
          },
          {
            goalNumber: 5,
            isOptional: true,
            title: 'Professional Closing',
            description: 'Wrap up with key takeaways and confirm next steps',
            keyBehaviors: ['Summarize concisely', 'Invite feedback', 'Confirm follow-ups'],
            successIndicators: ['Priya acknowledges strengths', 'Next steps are clear', 'Conversation ends confidently'],
          },
        ],
      },
      {
        title: 'The Technical & Cultural Fit Interview',
        slug: 'tech-cultural-interview-alex',
        description: 'Impress a passionate tech lead while showing genuine enthusiasm for the role',
        scenario: 'You\'re interviewing with Alex Chen, the engineering lead at a fast-growing startup. The conversation is more casual than formal, and Alex seems genuinely excited about the technology and team culture.',
        objectives: ['Show your technical competence and cultural fit', 'Demonstrate resilience and a positive attitude', 'Express genuine enthusiasm for the role and technology'],
        difficulty: SimulationDifficulty.BEGINNER,
        status: SimulationStatus.PUBLISHED,
        estimatedDurationMinutes: 20,
        skillsToLearn: ['Cultural fit assessment', 'Enthusiasm communication', 'Technical discussion', 'Team collaboration'],
        tags: ['interview', 'technical', 'startup', 'culture'],
        isPublic: true,
        viewCount: 0,
        category: createdCategories[0], // Job Seeking
        personas: [createdPersonas[1]], // Alex Chen
        successCriteria: {
          communication: ['Genuine enthusiasm', 'Technical clarity', 'Collaborative language'],
          problemSolving: ['Creative thinking', 'Problem-solving approach', 'Learning mindset'],
          emotional: ['Positive energy', 'Resilience indicators', 'Team-first attitude'],
        },
        conversationGoals: [
          {
            goalNumber: 1,
            title: 'Casual Opening and Energy Matching',
            description: 'Match Alex\'s enthusiastic energy while keeping the conversation natural and genuine',
            keyBehaviors: ['Show genuine excitement', 'Match his casual tone', 'Express interest in the company mission'],
            successIndicators: ['Alex becomes more animated', 'Conversation flows naturally', 'Mutual enthusiasm builds'],
          },
          {
            goalNumber: 2,
            title: 'Technical Discussion',
            description: 'Engage in technical conversation that demonstrates both competence and curiosity',
            keyBehaviors: ['Ask thoughtful technical questions', 'Share relevant experiences', 'Show learning mindset'],
            successIndicators: ['Alex gets excited about technical details', 'Deep technical conversation emerges', 'He starts sharing insider perspectives'],
          },
          {
            goalNumber: 3,
            title: 'Team Culture Exploration',
            description: 'Explore the team dynamics and show how you would contribute to the collaborative culture',
            keyBehaviors: ['Ask about team collaboration', 'Share team-oriented experiences', 'Show resilience stories'],
            successIndicators: ['Alex talks about team members positively', 'He shares challenges and growth stories', 'Discussion becomes very interactive'],
          },
          {
            goalNumber: 4,
            title: 'Problem-Solving Demonstration',
            description: 'Show your approach to problem-solving and handling challenges in a startup environment',
            keyBehaviors: ['Discuss creative solutions', 'Show adaptability', 'Demonstrate growth mindset'],
            successIndicators: ['Alex poses hypothetical challenges', 'He shows excitement about your approaches', 'Conversation becomes collaborative problem-solving'],
          },
          {
            goalNumber: 5,
            title: 'Enthusiastic Wrap-up',
            description: 'Close with genuine excitement about the opportunity and next steps',
            keyBehaviors: ['Express authentic enthusiasm', 'Ask about immediate challenges', 'Show eagerness to contribute'],
            successIndicators: ['Alex expresses strong interest', 'He talks about onboarding and team introduction', 'Conversation ends on a high note'],
          },
        ],
      },
      {
        title: 'Pitching Your Idea',
        slug: 'pitching-idea-david',
        description: 'Convince a skeptical veteran analyst to support your new initiative',
        scenario: 'You need to get buy-in from David Miller, a senior analyst who has been with the company for 15 years. He\'s known for being resistant to change and will likely challenge your proposal with tough questions.',
        objectives: ['Present your idea convincingly with data and logic', 'Respect David\'s experience and expertise', 'Address his concerns and objections thoroughly'],
        difficulty: SimulationDifficulty.ADVANCED,
        status: SimulationStatus.PUBLISHED,
        estimatedDurationMinutes: 30,
        skillsToLearn: ['Persuasion', 'Stakeholder management', 'Data-driven arguments', 'Respect for experience'],
        tags: ['persuasion', 'stakeholder', 'data', 'resistance'],
        isPublic: true,
        viewCount: 0,
        category: createdCategories[1], // Workplace Communication
        personas: [createdPersonas[2]], // David Miller
        successCriteria: {
          communication: ['Data-backed arguments', 'Respectful tone', 'Acknowledging expertise'],
          problemSolving: ['Addressing objections', 'Risk mitigation', 'Practical solutions'],
          emotional: ['Patience with resistance', 'Respect for experience', 'Collaborative approach'],
        },
        conversationGoals: [
          {
            goalNumber: 1,
            isOptional: true,
            title: 'Respectful Opening and Context',
            description: 'Start by acknowledging David\'s expertise and experience before presenting your idea',
            keyBehaviors: ['Acknowledge his experience', 'Show respect for his expertise', 'Set collaborative tone'],
            successIndicators: ['David shows initial willingness to listen', 'His defensive posture softens slightly', 'He asks clarifying questions'],
          },
          {
            goalNumber: 2,
            title: 'Data-Driven Presentation',
            description: 'Present your idea with solid data, research, and logical reasoning that appeals to David\'s analytical nature',
            keyBehaviors: ['Present clear data', 'Use logical structure', 'Reference industry standards'],
            successIndicators: ['David asks for more details', 'He challenges specific points constructively', 'His questions become more engaged'],
          },
          {
            goalNumber: 3,
            title: 'Addressing Skepticism',
            description: 'Proactively address David\'s concerns and objections with patience and additional evidence',
            keyBehaviors: ['Listen to objections carefully', 'Provide thoughtful responses', 'Acknowledge valid concerns'],
            successIndicators: ['David\'s objections become more specific', 'He starts suggesting modifications', 'His tone becomes less dismissive'],
          },
          {
            goalNumber: 4,
            title: 'Incorporating His Expertise',
            description: 'Ask for his input and show how his experience could strengthen the proposal',
            keyBehaviors: ['Ask for his insights', 'Incorporate his suggestions', 'Value his institutional knowledge'],
            successIndicators: ['David begins contributing ideas', 'He shares relevant historical context', 'His body language opens up'],
          },
          {
            goalNumber: 5,
            isOptional: true,
            title: 'Collaborative Next Steps',
            description: 'Work together to define next steps and get his support for moving forward',
            keyBehaviors: ['Propose pilot approach', 'Ask for his ongoing involvement', 'Define success metrics together'],
            successIndicators: ['David agrees to support or trial', 'He offers to help with implementation', 'Conversation ends with mutual respect'],
          },
        ],
      },
      {
        title: 'Saying "No" to Extra Work',
        slug: 'saying-no-sarah',
        description: 'Practice setting boundaries with an overwhelmed colleague trying to delegate work to you',
        scenario: 'Sarah Jenkins, a project manager from another team, approaches you asking for help with a task she\'s behind on. She\'s clearly stressed and frames it as a small favor, but you\'re already at capacity.',
        objectives: ['Decline the request firmly but kindly', 'Maintain a good working relationship', 'Show empathy for her stressful situation'],
        difficulty: SimulationDifficulty.BEGINNER,
        status: SimulationStatus.PUBLISHED,
        estimatedDurationMinutes: 15,
        skillsToLearn: ['Boundary setting', 'Empathetic communication', 'Saying no professionally', 'Relationship management'],
        tags: ['boundaries', 'communication', 'assertiveness', 'empathy'],
        isPublic: true,
        viewCount: 0,
        category: createdCategories[1], // Workplace Communication
        personas: [createdPersonas[3]], // Sarah Jenkins
        successCriteria: {
          communication: ['Clear boundaries', 'Empathetic tone', 'Alternative solutions'],
          problemSolving: ['Win-win thinking', 'Resource management', 'Priority setting'],
          emotional: ['Assertiveness', 'Compassion', 'Professional warmth'],
        },
        conversationGoals: [
          {
            goalNumber: 1,
            title: 'Empathetic Listening',
            description: 'Listen to Sarah\'s request with empathy and acknowledge her stressful situation',
            keyBehaviors: ['Show genuine concern', 'Listen actively', 'Acknowledge her stress'],
            successIndicators: ['Sarah feels heard and understood', 'Her anxiety decreases slightly', 'She provides more context about her situation'],
          },
          {
            goalNumber: 2,
            title: 'Honest Assessment',
            description: 'Honestly assess and communicate your current capacity and commitments',
            keyBehaviors: ['Explain your current workload', 'Be transparent about constraints', 'Show you take commitments seriously'],
            successIndicators: ['Sarah understands your situation', 'She shows some disappointment but acceptance', 'Conversation remains professional'],
          },
          {
            goalNumber: 3,
            isOptional: true,
            title: 'Alternative Solutions',
            description: 'Offer alternative solutions or resources that might help Sarah without compromising your boundaries',
            keyBehaviors: ['Suggest other resources', 'Offer limited assistance', 'Provide constructive alternatives'],
            successIndicators: ['Sarah considers the alternatives', 'She expresses gratitude for suggestions', 'Her stress level appears to decrease'],
          },
          {
            goalNumber: 4,
            isOptional: true,
            title: 'Future Support',
            description: 'Discuss how you might be able to help in the future or prevent similar situations',
            keyBehaviors: ['Offer future availability', 'Suggest better planning', 'Maintain positive relationship'],
            successIndicators: ['Sarah feels supported long-term', 'She accepts the boundary gracefully', 'Relationship remains intact'],
          },
          {
            goalNumber: 5,
            isOptional: true,
            title: 'Professional Closure',
            description: 'Close the conversation on a positive note while maintaining your boundary',
            keyBehaviors: ['Reaffirm your support', 'Maintain professional warmth', 'Wish her success'],
            successIndicators: ['Sarah leaves with understanding', 'Professional relationship is preserved', 'She respects your boundaries'],
          },
        ],
      },
      {
        title: 'Re-engaging a Disengaged Employee',
        slug: 'reengaging-michael',
        description: 'Conduct a challenging feedback conversation with a high-performer who has become disengaged',
        scenario: 'Michael Reyes, once your star developer, has become increasingly disengaged. His work quality remains high, but his participation in meetings and team activities has dropped significantly. You need to address this in a one-on-one meeting.',
        objectives: ['Uncover the root cause of Michael\'s disengagement', 'Work together to find a path forward', 'Re-ignite his motivation and engagement'],
        difficulty: SimulationDifficulty.EXPERT,
        status: SimulationStatus.PUBLISHED,
        estimatedDurationMinutes: 35,
        skillsToLearn: ['Performance management', 'Active listening', 'Employee engagement', 'Career development'],
        tags: ['leadership', 'engagement', 'performance', 'motivation'],
        isPublic: true,
        viewCount: 0,
        category: createdCategories[2], // Leadership
        personas: [createdPersonas[4]], // Michael Reyes
        successCriteria: {
          communication: ['Probing questions', 'Non-judgmental tone', 'Career-focused discussion'],
          problemSolving: ['Root cause analysis', 'Growth opportunities', 'Challenge identification'],
          emotional: ['Patience with silence', 'Empathy for boredom', 'Motivation building'],
        },
        conversationGoals: [
          {
            goalNumber: 1,
            isOptional: true,
            title: 'Non-Threatening Opening',
            description: 'Start the conversation with a non-judgmental tone that makes Michael feel safe to open up',
            keyBehaviors: ['Avoid accusatory language', 'Express appreciation for his work', 'Set collaborative tone'],
            successIndicators: ['Michael doesn\'t become defensive', 'He maintains eye contact', 'His posture remains open'],
          },
          {
            goalNumber: 2,
            title: 'Observation Without Judgment',
            description: 'Share your observations about his decreased engagement without making it personal',
            keyBehaviors: ['Focus on behaviors not personality', 'Use specific examples', 'Ask open-ended questions'],
            successIndicators: ['Michael acknowledges the observations', 'He doesn\'t deny or get defensive', 'He begins to share some context'],
          },
          {
            goalNumber: 3,
            title: 'Deep Listening and Probing',
            description: 'Listen carefully and ask probing questions to understand the root cause of his disengagement',
            keyBehaviors: ['Ask about career satisfaction', 'Explore his current challenges', 'Listen for unmet needs'],
            successIndicators: ['Michael opens up about his feelings', 'He shares frustrations or concerns', 'The real issues begin to surface'],
          },
          {
            goalNumber: 4,
            title: 'Exploring Growth Opportunities',
            description: 'Discuss potential growth opportunities and new challenges that might re-engage him',
            keyBehaviors: ['Propose new challenges', 'Discuss career development', 'Explore his interests and goals'],
            successIndicators: ['Michael shows increased interest', 'He begins suggesting ideas', 'His energy level noticeably increases'],
          },
          {
            goalNumber: 5,
            isOptional: true,
            title: 'Action Planning and Commitment',
            description: 'Work together to create a specific action plan for his re-engagement and growth',
            keyBehaviors: ['Co-create development plan', 'Set specific goals and timelines', 'Get his commitment'],
            successIndicators: ['Michael actively participates in planning', 'He shows enthusiasm for the plan', 'Clear next steps are established'],
          },
        ],
      },
      {
        title: 'Delegating a Task',
        slug: 'delegating-task-chloe',
        description: 'Successfully delegate a complex task to an eager but anxious junior team member',
        scenario: 'You need to delegate an important client presentation to Chloe Davis, a junior marketing coordinator. She\'s enthusiastic and hardworking but tends to struggle with confidence and may not ask questions when she should.',
        objectives: ['Delegate the task clearly with proper expectations', 'Ensure Chloe understands timelines and deliverables', 'Make her feel comfortable asking for help when needed'],
        difficulty: SimulationDifficulty.INTERMEDIATE,
        status: SimulationStatus.PUBLISHED,
        estimatedDurationMinutes: 20,
        skillsToLearn: ['Delegation skills', 'Clear communication', 'Confidence building', 'Check-in processes'],
        tags: ['delegation', 'leadership', 'confidence', 'junior'],
        isPublic: true,
        viewCount: 0,
        category: createdCategories[2], // Leadership
        personas: [createdPersonas[5]], // Chloe Davis
        successCriteria: {
          communication: ['Clear instructions', 'Encouraging tone', 'Open-ended questions'],
          problemSolving: ['Detailed planning', 'Resource provision', 'Safety net creation'],
          emotional: ['Confidence building', 'Psychological safety', 'Support offering'],
        },
        conversationGoals: [
          {
            goalNumber: 1,
            isOptional: true,
            title: 'Opening and Context Setting',
            description: 'Start the conversation by setting a supportive tone and explaining why Chloe was chosen for this task',
            keyBehaviors: ['Acknowledge her strengths', 'Express confidence in her abilities', 'Set positive tone'],
            successIndicators: ['Chloe feels valued and chosen for good reasons', 'Initial nervousness begins to subside', 'She shows engagement and interest'],
          },
          {
            goalNumber: 2,
            title: 'Task Overview and Importance',
            description: 'Clearly explain what the client presentation entails and why it\'s important to the team/company',
            keyBehaviors: ['Provide clear context', 'Explain the task\'s significance', 'Share the bigger picture'],
            successIndicators: ['Chloe understands the task scope', 'She grasps the importance without feeling overwhelmed', 'Questions start to emerge naturally'],
          },
          {
            goalNumber: 3,
            title: 'Detailed Requirements and Expectations',
            description: 'Break down the specific deliverables, timeline, and quality expectations for the presentation',
            keyBehaviors: ['Be specific about deliverables', 'Set clear deadlines', 'Define success criteria'],
            successIndicators: ['Chloe can repeat back key requirements', 'Timeline is clearly understood', 'Expectations are realistic and achievable'],
          },
          {
            goalNumber: 4,
            title: 'Resource Provision and Support Structure',
            description: 'Identify what resources, tools, and support Chloe will have access to complete the task',
            keyBehaviors: ['List available resources', 'Introduce key contacts', 'Explain support systems'],
            successIndicators: ['Chloe knows where to find help', 'Resources are clearly identified', 'Support network is established'],
          },
          {
            goalNumber: 5,
            isOptional: true,
            title: 'Check-in Schedule and Communication Plan',
            description: 'Establish regular check-ins and make it safe for Chloe to ask questions or raise concerns',
            keyBehaviors: ['Schedule specific check-ins', 'Encourage questions', 'Create psychological safety'],
            successIndicators: ['Regular meeting times are set', 'Chloe feels comfortable asking questions', 'Communication preferences are established'],
          },
          {
            goalNumber: 6,
            title: 'Confidence Building and Final Agreement',
            description: 'Reinforce confidence in Chloe\'s abilities and get her explicit agreement to take on the task',
            keyBehaviors: ['Reinforce her capabilities', 'Address any final concerns', 'Get clear commitment'],
            successIndicators: ['Chloe expresses confidence (even if nervous)', 'Any final questions are addressed', 'Agreement is reached and Chloe accepts the task'],
          },
        ],
      },
    ];

    // Save simulations with many-to-many relationships
    const createdSimulations = [];
    for (const simulationData of simulations) {
      // Extract personas for separate handling
      const { personas, ...simulationFields } = simulationData;
      
      // Create simulation without personas first
      const simulation = simulationRepository.create(simulationFields);
      const savedSimulation = await simulationRepository.save(simulation);
      
      // Set the personas relationship
      savedSimulation.personas = personas as unknown as Persona[];
      await simulationRepository.save(savedSimulation);
      
      createdSimulations.push(savedSimulation);
    }
    console.log('🎭 Created simulations:', String(createdSimulations.length));

    // Seed Admin User
    const adminPassword = await AuthUtils.hashPassword('admin123!@#');
    const adminUser = userRepository.create({
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@careersim.ai',
      password: adminPassword,
      role: UserRole.ADMIN,
      subscriptionTier: SubscriptionTier.PREMIUM,
      isEmailVerified: true,
      isActive: true,
    });

    await userRepository.save(adminUser);
    console.log('👤 Created admin user: admin@careersim.ai / admin123!@#');

    // Seed Test Users
    const testUsers = [
      {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        subscriptionTier: SubscriptionTier.FREEMIUM,
        monthlySimulationsUsed: 1,
      },
      {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        subscriptionTier: SubscriptionTier.PRO,
        totalSimulationsCompleted: 5,
      },
      {
        firstName: 'Mike',
        lastName: 'Johnson',
        email: 'mike@example.com',
        subscriptionTier: SubscriptionTier.PREMIUM,
        totalSimulationsCompleted: 12,
      },
    ];

    for (const userData of testUsers) {
      const hashedPassword = await AuthUtils.hashPassword('password123');
      const user = userRepository.create({
        ...userData,
        password: hashedPassword,
        role: UserRole.USER,
        isEmailVerified: true,
        isActive: true,
      });
      await userRepository.save(user);
    }

    console.log('👥 Created test users');

    // Seed System Configurations
    console.log('\n⚙️ Seeding system configurations...');
    
    const aiSettingsConfig = configRepository.create({
      configKey: SystemConfiguration.CONFIG_KEYS.AI_MODEL_SETTINGS,
      aiModelSettings: SystemConfiguration.getDefaultAISettings(),
      description: 'AI model configuration settings',
      isActive: true,
    });

    const systemPromptsConfig = configRepository.create({
      configKey: SystemConfiguration.CONFIG_KEYS.SYSTEM_PROMPTS,
      systemPrompts: SystemConfiguration.getDefaultSystemPrompts(),
      description: 'System prompt templates for AI interactions',
      isActive: true,
    });

    const rateLimitConfig = configRepository.create({
      configKey: SystemConfiguration.CONFIG_KEYS.RATE_LIMIT_SETTINGS,
      rateLimitSettings: SystemConfiguration.getDefaultRateLimitSettings(),
      description: 'Rate limiting configuration for API endpoints',
      isActive: true,
    });

    const configs = await configRepository.save([
      aiSettingsConfig,
      systemPromptsConfig,
      rateLimitConfig,
    ]);

    console.log('✅ Database seeding completed!');
    console.log('\n📊 Summary:');
    console.log(`Categories: ${String(categories.length)}`);
    console.log(`Personas: ${String(createdPersonas.length)}`);
    console.log(`Simulations: ${String(createdSimulations.length)}`);
    console.log(`Users: ${String(testUsers.length + 1)} (including admin)`);
    console.log(`System Configurations: ${String(configs.length)}`);
    console.log('\n🔐 Admin Login:');
    console.log('Email: admin@careersim.ai');
    console.log('Password: admin123!@#');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
    console.log('🔌 Database connection closed');
  }
};

// Run the seed script
if (require.main === module) {
  seedData();
}

export default seedData; 