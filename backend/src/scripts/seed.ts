import 'reflect-metadata';
import { AppDataSource } from '@/config/database';
import { User } from '@/entities/User';
import { UserRole, SubscriptionTier } from '@/types';
import { Category } from '@/entities/Category';
import { Persona, PersonaCategory } from '@/entities/Persona';
import { Simulation, SimulationDifficulty, SimulationStatus } from '@/entities/Simulation';
import { SystemConfiguration } from '@/entities/SystemConfiguration';
import { AuthUtils } from '@/utils/auth';

const seedData = async (): Promise<void> => {
  try {
    console.log('🌱 Starting database seeding...');

    // Initialize database connection
    await AppDataSource.initialize();
    console.log('✅ Database connected');

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
      console.log('⚠️ Some tables may not exist yet, continuing...', error.message);
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
    console.log('📁 Created categories:', createdCategories.length);

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
        },
      },
    ];

    const createdPersonas = await personaRepository.save(personas);
    console.log('👥 Created personas:', createdPersonas.length);

    // Seed Simulations
    const simulations = [
      {
        title: 'The Behavioral Interview',
        slug: 'behavioral-interview-brenda',
        description: 'Navigate a structured behavioral interview with a risk-averse HR manager',
        scenario: 'You\'re interviewing for a mid-level position at a well-established corporation. The HR manager, Brenda Vance, is conducting a formal behavioral interview. She seems professional but distant, and you sense she\'s being very careful about her hiring decisions.',
        objectives: ['Demonstrate your qualifications while building rapport', 'Address any concerns about your fit for the company culture', 'Show self-awareness and professionalism'],
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
      savedSimulation.personas = personas;
      await simulationRepository.save(savedSimulation);
      
      createdSimulations.push(savedSimulation);
    }
    console.log('🎭 Created simulations:', createdSimulations.length);

    // Seed Admin User
    const adminPassword = await AuthUtils.hashPassword('admin123!@#');
    const adminUser = userRepository.create({
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@careersim.com',
      password: adminPassword,
      role: UserRole.ADMIN,
      subscriptionTier: SubscriptionTier.PREMIUM,
      isEmailVerified: true,
      isActive: true,
    });

    await userRepository.save(adminUser);
    console.log('👤 Created admin user: admin@careersim.com / admin123!@#');

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
    console.log(`Categories: ${categories.length}`);
    console.log(`Personas: ${createdPersonas.length}`);
    console.log(`Simulations: ${createdSimulations.length}`);
    console.log(`Users: ${testUsers.length + 1} (including admin)`);
    console.log(`System Configurations: ${configs.length}`);
    console.log('\n🔐 Admin Login:');
    console.log('Email: admin@careersim.com');
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