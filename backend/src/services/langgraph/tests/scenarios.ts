/**
 * Test Scenarios for LangGraph DeepEval Integration
 * 
 * Defines ConversationalGolden scenarios for testing various conversation flows
 */

import { ConversationalGolden, Turn } from 'deepeval-ts';

/**
 * Scenario 1: Basic Multi-Turn Conversation
 * 
 * Tests normal back-and-forth dialogue with the AI persona
 */
export function createBasicConversationScenario(): ConversationalGolden {
  return new ConversationalGolden({
    scenario: 'A candidate is starting a job interview simulation and wants to introduce themselves professionally.',
    expectedOutcome: 'The candidate successfully introduces themselves and the interviewer responds positively, establishing rapport.',
    userDescription: 'A professional job seeker preparing for interviews, confident but slightly nervous.',
  });
}

/**
 * Scenario 2: Goal Achievement Conversation
 * 
 * Tests conversation that progresses through multiple simulation goals
 */
export function createGoalAchievementScenario(): ConversationalGolden {
  return new ConversationalGolden({
    scenario: 'A candidate wants to demonstrate their technical skills and experience during a job interview, progressing through key interview milestones.',
    expectedOutcome: 'The candidate successfully covers their background, skills, and experience while the interviewer evaluates them, achieving at least one conversation goal.',
    userDescription: 'An experienced software engineer with strong technical skills, eager to showcase their accomplishments.',
  });
}

/**
 * Scenario 3: Proactive Start
 * 
 * Tests AI-initiated conversation (no initial user message)
 */
export function createProactiveStartScenario(): ConversationalGolden {
  return new ConversationalGolden({
    scenario: 'The AI interviewer initiates the conversation with a professional greeting.',
    expectedOutcome: 'The interviewer starts the conversation proactively and engages the candidate.',
    userDescription: 'A candidate waiting for the interview to begin.',
    turns: [], // Empty turns means AI should start
  });
}

/**
 * Scenario 4: Short Responses Leading to Follow-ups
 * 
 * Tests AI's ability to handle brief user responses and ask follow-up questions
 */
export function createFollowupScenario(): ConversationalGolden {
  return new ConversationalGolden({
    scenario: 'A candidate gives brief, minimal answers and the interviewer needs to probe deeper with follow-up questions.',
    expectedOutcome: 'The interviewer successfully elicits more detailed information through strategic follow-up questions.',
    userDescription: 'A nervous candidate who tends to give short answers initially but has good information to share.',
  });
}

/**
 * Scenario 5: Complex Multi-Goal Conversation
 * 
 * Tests comprehensive simulation with multiple conversation goals
 */
export function createComplexMultiGoalScenario(): ConversationalGolden {
  return new ConversationalGolden({
    scenario: 'A candidate participates in a comprehensive job interview covering introduction, technical discussion, behavioral questions, and closing.',
    expectedOutcome: 'The candidate and interviewer progress through multiple stages of the interview, achieving several conversation goals in sequence.',
    userDescription: 'A well-prepared candidate with strong communication skills, ready for a thorough interview process.',
  });
}

/**
 * Scenario 6: Difficult Questions and Problem-Solving
 * 
 * Tests AI's ability to pose challenging questions and evaluate responses
 */
export function createDifficultQuestionScenario(): ConversationalGolden {
  return new ConversationalGolden({
    scenario: 'The interviewer asks challenging technical and behavioral questions to assess the candidate\'s problem-solving abilities.',
    expectedOutcome: 'The candidate demonstrates their problem-solving approach and the interviewer evaluates their responses critically.',
    userDescription: 'A confident candidate who enjoys tackling difficult questions and explaining their thought process.',
  });
}

/**
 * Scenario 7: Emotional Intelligence Test
 * 
 * Tests conversation with emotional dynamics and sentiment analysis
 */
export function createEmotionalIntelligenceScenario(): ConversationalGolden {
  return new ConversationalGolden({
    scenario: 'The candidate discusses challenging workplace situations, demonstrating emotional intelligence and professional maturity.',
    expectedOutcome: 'The conversation covers emotionally complex topics while maintaining professionalism, with the AI adapting to emotional cues.',
    userDescription: 'A mature professional who can discuss difficult situations with emotional awareness and composure.',
  });
}

/**
 * Scenario 8: Rapport Building and Connection
 * 
 * Tests the AI's ability to build genuine rapport with the user
 */
export function createRapportBuildingScenario(): ConversationalGolden {
  return new ConversationalGolden({
    scenario: 'The candidate and interviewer engage in rapport-building conversation, finding common ground and establishing a positive connection.',
    expectedOutcome: 'A warm, professional relationship develops through the conversation with natural flow and mutual understanding.',
    userDescription: 'A personable candidate who values relationship-building and genuine human connection.',
  });
}

/**
 * Scenario 9: Handling Uncertainty
 * 
 * Tests AI's response when candidate doesn't know something
 */
export function createUncertaintyHandlingScenario(): ConversationalGolden {
  return new ConversationalGolden({
    scenario: 'The candidate encounters questions they cannot fully answer and must navigate uncertainty professionally.',
    expectedOutcome: 'The candidate acknowledges gaps in knowledge professionally, and the interviewer responds appropriately, guiding the conversation forward.',
    userDescription: 'An honest candidate who is comfortable admitting when they don\'t know something.',
  });
}

/**
 * Scenario 10: Career Transition Discussion
 * 
 * Tests complex career narrative with transitions and motivations
 */
export function createCareerTransitionScenario(): ConversationalGolden {
  return new ConversationalGolden({
    scenario: 'The candidate discusses their career transition, explaining their motivations for change and how their past experience is relevant.',
    expectedOutcome: 'The interviewer understands the candidate\'s career journey and motivations, with both parties exploring fit and alignment.',
    userDescription: 'A professional making a career transition who needs to articulate their transferable skills and motivations convincingly.',
  });
}

/**
 * Helper function to get all scenarios
 */
export function getAllScenarios(): ConversationalGolden[] {
  return [
    createBasicConversationScenario(),
    createGoalAchievementScenario(),
    createProactiveStartScenario(),
    createFollowupScenario(),
    createComplexMultiGoalScenario(),
    createDifficultQuestionScenario(),
    createEmotionalIntelligenceScenario(),
    createRapportBuildingScenario(),
    createUncertaintyHandlingScenario(),
    createCareerTransitionScenario(),
  ];
}

/**
 * Helper function to get basic test scenarios (subset for faster testing)
 */
export function getBasicTestScenarios(): ConversationalGolden[] {
  return [
    createBasicConversationScenario(),
    createGoalAchievementScenario(),
    createProactiveStartScenario(),
  ];
}

/**
 * Helper function to get advanced test scenarios
 */
export function getAdvancedTestScenarios(): ConversationalGolden[] {
  return [
    createComplexMultiGoalScenario(),
    createDifficultQuestionScenario(),
    createEmotionalIntelligenceScenario(),
    createCareerTransitionScenario(),
  ];
}

