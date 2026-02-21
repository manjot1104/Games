import mongoose, { Schema } from 'mongoose';

const GameLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    type: { 
      type: String, 
      enum: [
        'tap','match','sort','emoji','quiz',
        'follow-ball','movingTarget','pop','tapAndHold','multiTap',
        'smallCircleTap','tapOnlySmall','shrinkingTarget','trackThenTap','multipleSmallTargets',
        'tapSlowly','tapFast','slowThenFast','raceTheDot',
        'holdTheButton','growTheBalloon','launchRocket','squishTheJelly','holdTheLight',
        'dragBallToGoal','followTheLine','dragAnimalHome','dragSlowly','puzzlePieceDrag',
        'tapTheNumbers','tapLightsInOrder','followTheArrows','tapColoursInOrder',
        'tapTheBigOne','tapTheSmallOne','tapTheShapeIShowYou','findTheOddOneOut',
        'matchShapeToOutline','tinyDotTap','tapTheCenterOfTheTarget','movingSmallTarget',
        'tapOnlyTheSmallestShape','tapTheHiddenSmallObject','shrinkingCircleTap',
        'tapWhenStarIsSmallest','shrinkStopTap','multipleShrinkingTargets','shrinkingObjectMovement',
        'pinchToPop','twoFingerSimultaneousTap','pinchToResize','pinchToOpenTreasureBox',
    
        // Speech / new ones from navdeep
        'follow-my-point','point-to-object-appears','tap-the-pointed-object','moving-arm-pointing',
        'multi-point-follow','tap-what-you-like','which-one-moved','sound-to-choice','show-me-the-toy',
        'food-vs-toy','pass-the-ball','tap-only-on-your-turn','your-turn-to-complete','wait-for-the-signal',
        'turn-timer','watch-and-wait','growing-flower','timer-bar-tap','follow-slow-movement',
        'shapes-appear-one-by-one','touch-the-ball','tap-the-circle','find-the-sound-source',
        'tap-what-i-show-you','follow-the-arrow','tap-the-target-ignore-distraction',
        'sound-distraction-challenge','slow-task-with-pop-up-distraction','sequence-with-distraction',
        'moving-target-with-extra-objects','jaw-awareness-crocodile',
        'jaw-swing-adventure','jaw-push-challenge','jaw-rhythm-tap','jaw-strength-builder',
        'rainbow-curve-trace','drive-car-curvy-road','trace-smiling-mouth','ball-roll-curved-track','paint-curved-snake'
      ], 
      required: true 
    },
    
    mode:   { type: String, enum: ['free-play', 'therapy', 'guided'], default: 'free-play' },
    difficulty: { type: String },
    skillTags: { type: [String], default: [] },
    level: { type: Number },
    correct:   { type: Number, default: 0 },
    total:     { type: Number, default: 0 },
    accuracy:  { type: Number, default: 0 }, // 0..100
    xpAwarded: { type: Number, default: 0 },
    durationMs:{ type: Number, default: 0 },
    responseTimeMs: { type: Number, default: 0 },
    hintsUsed: { type: Number, default: 0 },
    incorrectAttempts: { type: Number, default: 0 },
    feedback: {
      type: new Schema(
        {
          mood: { type: Number, min: 1, max: 5 },
          notes: { type: String },
          observer: { type: String },
        },
        { _id: false },
      ),
      default: undefined,
    },
    at:        { type: Date,   default: Date.now },
    // Quiz-specific metadata and future telemetry
    meta: { type: Schema.Types.Mixed, default: () => ({}) }, // For quiz: { level, categories, categoryPerformance }
  },
  { _id: false }
);

const SessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    // (keep any lesson fields if you still use them)
    lessonId: String,
    startedAt: Date,
    endedAt: Date,
    score: Number,
    accuracy: Number,
    promptsUsed: Number,
    traceJson: Schema.Types.Mixed,

    // NEW aggregated + per-game
    points: { type: Number, default: 0 },
    totalGamesPlayed: { type: Number, default: 0 },
    gameLogs: { type: [GameLogSchema], default: [] },
  },
  { timestamps: true }
);

export const Session = mongoose.models.Session || mongoose.model('Session', SessionSchema);
