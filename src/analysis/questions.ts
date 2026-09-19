import { choice } from '@typesafe-ai/sdk';

export const analysisQuestions = {
  goalClarity: choice('How clearly does the prompt state its primary goal?', {
    clear: 'The primary goal is explicit and actionable.',
    partial: 'A likely goal is present but important details are implicit.',
    unclear: 'No reliable primary goal can be identified.',
  }),
  taskType: choice('What is the primary task type?', {
    question: null,
    investigation: null,
    implementation: null,
    debugging: null,
    review: null,
    planning: null,
    operation: null,
    mixed: null,
    unknown: null,
  }),
  targetContext: choice('Are the target and relevant context identified?', {
    identified: 'The target and relevant context are specific.',
    partial: 'Either the target or necessary context is incomplete.',
    missing: 'The target or context cannot be identified reliably.',
  }),
  constraints: choice('How well are constraints and scope boundaries specified?', {
    explicit: 'Material constraints and boundaries are explicit.',
    partial: 'Some boundaries are present but material ambiguity remains.',
    missing: 'No meaningful constraints or boundaries are provided.',
  }),
  successCriteria: choice('How are success and verification requirements specified?', {
    explicit: 'Observable success and verification criteria are explicit.',
    implied: 'Success can be inferred but verification is not explicit.',
    missing: 'Success cannot be evaluated reliably from the prompt.',
  }),
  goalCompatibility: choice('Does the prompt contain multiple or conflicting goals?', {
    single: 'There is one goal or several compatible subgoals.',
    multiple: 'There are multiple goals without an explicit conflict.',
    conflicting: 'Two or more goals or constraints conflict.',
  }),
  expectedBehavior: choice('What primary behavior will the agent likely perform?', {
    answer: null,
    search: null,
    read: null,
    edit: null,
    test: null,
    git: null,
    network: null,
    external_side_effect: null,
    mixed: null,
    unknown: null,
  }),
  risk: choice('What is the highest material risk implied by the prompt?', {
    none: 'No material destructive, credential, deployment, or privacy risk.',
    destructive: 'May delete, overwrite, or irreversibly alter data or resources.',
    credential: 'May expose, request, store, or transmit credentials or secrets.',
    deployment: 'May publish or change a deployed environment.',
    privacy: 'May expose or transmit private or personal information.',
    multiple: 'More than one material risk category applies.',
  }),
  instructionConflict: choice('Does the prompt conflict with any supplied instruction?', {
    aligned: 'No conflict is present.',
    uncertain: 'A possible conflict cannot be resolved from the supplied context.',
    conflicting: 'The prompt conflicts with a supplied instruction.',
  }),
} as const;
