import { advanceTherapyProgress, fetchTherapyProgress, initTherapyProgress, type TherapyProgress } from '@/utils/api';
import { useEffect, useState } from 'react';

export interface SpecialEducationProgress {
  sections: Array<{
    sectionNumber: number;
    levels: Array<{
      levelNumber: number;
      games: Array<{
        gameNumber: number;
        completed: boolean;
        accuracy: number;
        lastPlayedAt?: string;
      }>;
      completed: boolean;
    }>;
    completed: boolean;
    unlocked: boolean;
  }>;
  currentSection: number;
  currentLevel: number;
  currentGame: number;
}

export function useSpecialEducationProgress() {
  const [progress, setProgress] = useState<SpecialEducationProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProgress();
  }, []);

  const loadProgress = async () => {
    try {
      setLoading(true);
      const response = await fetchTherapyProgress();
      const specialEd = response.therapies.find((t) => t.therapy === 'special-education');
      
      if (specialEd && specialEd.sections) {
        setProgress({
          sections: specialEd.sections,
          currentSection: specialEd.currentSection || 1,
          currentLevel: specialEd.currentLevelSE || 1,
          currentGame: specialEd.currentGame || 1,
        });
      } else {
        // Initialize if not found
        const initResponse = await initTherapyProgress();
        const initSpecialEd = initResponse.therapies.find((t) => t.therapy === 'special-education');
        if (initSpecialEd && initSpecialEd.sections) {
          setProgress({
            sections: initSpecialEd.sections,
            currentSection: initSpecialEd.currentSection || 1,
            currentLevel: initSpecialEd.currentLevelSE || 1,
            currentGame: initSpecialEd.currentGame || 1,
          });
        }
      }
    } catch (error) {
      console.error('Failed to load special education progress:', error);
    } finally {
      setLoading(false);
    }
  };

  const markGameComplete = async (
    section: number,
    level: number,
    game: number,
    accuracy: number = 100
  ) => {
    try {
      await advanceTherapyProgress({
        therapy: 'special-education',
        sectionNumber: section,
        levelNumberSE: level,
        gameNumber: game,
        accuracy,
      });
      await loadProgress(); // Reload to get updated state
    } catch (error) {
      console.error('Failed to mark game complete:', error);
      throw error;
    }
  };

  return {
    progress,
    loading,
    markGameComplete,
    refresh: loadProgress,
  };
}

// Helper to check if a section/level/game is unlocked
export function isUnlocked(
  progress: SpecialEducationProgress | null,
  section: number,
  level: number,
  game: number
): boolean {
  if (!progress) return section === 1 && level === 1 && game === 1;
  
  const sectionData = progress.sections.find((s) => s.sectionNumber === section);
  if (!sectionData || !sectionData.unlocked) return false;
  
  // For POC, only Section 1, Level 1, Game 1 is unlocked
  if (section === 1 && level === 1 && game === 1) return true;
  
  // Future: Check if previous game/level/section is completed
  if (section === 1 && level === 1) {
    // Check if previous game is completed
    const levelData = sectionData.levels.find((l) => l.levelNumber === level);
    if (levelData && game > 1) {
      const prevGame = levelData.games.find((g) => g.gameNumber === game - 1);
      return prevGame?.completed || false;
    }
  }
  
  return false;
}

