import mongoose, { Schema } from 'mongoose';

const SessionProgressSchema = new Schema(
  {
    sessionNumber: { type: Number, required: true }, // 1..10 within a level
    completedGames: { type: [String], default: [] },  // ids of games completed (max 5)
    completed: { type: Boolean, default: false },
    lastPlayedAt: { type: Date },
  },
  { _id: false },
);

const LevelProgressSchema = new Schema(
  {
    levelNumber: { type: Number, required: true }, // 1..10 within a therapy
    sessions: { type: [SessionProgressSchema], default: [] },
  },
  { _id: false },
);

// Special Education: Game progress within a level
const GameProgressSchema = new Schema(
  {
    gameNumber: { type: Number, required: true }, // 1..5 within a level
    completed: { type: Boolean, default: false },
    accuracy: { type: Number, default: 0 }, // 0..100
    lastPlayedAt: { type: Date },
  },
  { _id: false },
);

// Special Education: Level progress within a section
const SpecialEducationLevelSchema = new Schema(
  {
    levelNumber: { type: Number, required: true }, // 1..10 within a section
    games: { type: [GameProgressSchema], default: [] },
    completed: { type: Boolean, default: false },
  },
  { _id: false },
);

// Special Education: Section progress
const SectionProgressSchema = new Schema(
  {
    sectionNumber: { type: Number, required: true }, // 1..10
    levels: { type: [SpecialEducationLevelSchema], default: [] },
    completed: { type: Boolean, default: false },
    unlocked: { type: Boolean, default: false },
  },
  { _id: false },
);

const TherapyProgressSchema = new Schema(
  {
    therapy: {
      type: String,
      enum: [
        'speech',
        'occupational',
        'behavioral',
        'special-education',
        'daily-activities',
        'therapy-avatar',
      ],
      required: true,
    },
    // Standard structure (for speech, occupational, behavioral, etc.)
    levels: { type: [LevelProgressSchema], default: [] },
    currentLevel: { type: Number, default: 1 },
    currentSession: { type: Number, default: 1 },
    // Special Education structure (section-based)
    sections: { type: [SectionProgressSchema], default: [] },
    currentSection: { type: Number, default: 1 },
    currentLevelSE: { type: Number, default: 1 }, // Level within section
    currentGame: { type: Number, default: 1 },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const UserTherapyProgressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, unique: true },
    therapies: { type: [TherapyProgressSchema], default: [] },
  },
  { timestamps: true },
);

export const UserTherapyProgress =
  mongoose.models.UserTherapyProgress ||
  mongoose.model('UserTherapyProgress', UserTherapyProgressSchema);







