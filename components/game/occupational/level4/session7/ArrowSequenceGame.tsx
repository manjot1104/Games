import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS, DEFAULT_TTS_RATE } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 8;
const SEQUENCE_LENGTH = 3; // Number of arrows in sequence
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ARROW_SIZE = 120;

type ArrowDirection = 'left' | 'right' | 'up' | 'down';

interface ArrowItem {
  id: number;
  direction: ArrowDirection;
  expectedHand: 'left' | 'right';
  x: number;
  y: number;
}

// Use shared TTS utility (speech-to-speech on web, expo-speech on native)
// Safe speech helper
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

const ArrowSequenceGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [sequence, setSequence] = useState<ArrowItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSequence, setShowSequence] = useState(false);
  const [isShowingSequence, setIsShowingSequence] = useState(false);

  const arrowOpacities = useRef<Map<number, Animated.Value>>(new Map()).current;
  const arrowScales = useRef<Map<number, Animated.Value>>(new Map()).current;
  const leftHandScale = useRef(new Animated.Value(1)).current;
  const rightHandScale = useRef(new Animated.Value(1)).current;

  const generateSequence = useCallback(() => {
    const directions: ArrowDirection[] = ['left', 'right', 'up', 'down'];
    const newSequence: ArrowItem[] = [];
    
    // Generate random positions for arrows
    const positions = [
      { x: SCREEN_WIDTH * 0.25, y: SCREEN_HEIGHT * 0.3 },
      { x: SCREEN_WIDTH * 0.5, y: SCREEN_HEIGHT * 0.3 },
      { x: SCREEN_WIDTH * 0.75, y: SCREEN_HEIGHT * 0.3 },
    ];
    
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      const dir = directions[Math.floor(Math.random() * directions.length)];
      let expectedHand: 'left' | 'right';
      
      // Cross-body mapping
      if (dir === 'left') {
        expectedHand = 'right';
      } else if (dir === 'right') {
        expectedHand = 'left';
      } else {
        expectedHand = Math.random() < 0.5 ? 'left' : 'right';
      }
      
      const arrow: ArrowItem = {
        id: i,
        direction: dir,
        expectedHand,
        x: positions[i].x,
        y: positions[i].y,
      };
      
      newSequence.push(arrow);
      
      // Initialize animations if needed
      if (!arrowOpacities.has(i)) {
        arrowOpacities.set(i, new Animated.Value(0));
        arrowScales.set(i, new Animated.Value(1));
      }
    }
    
    setSequence(newSequence);
    setCurrentIndex(0);
    setShowSequence(true);
    setIsShowingSequence(true);
    
    // Show sequence one by one
    newSequence.forEach((arrow, index) => {
      const opacity = arrowOpacities.get(arrow.id)!;
      const scale = arrowScales.get(arrow.id)!;
      
      setTimeout(() => {
        opacity.setValue(0);
        scale.setValue(0.5);
        
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.spring(scale, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
        ]).start();
      }, index * 800);
    });
    
    // After showing all arrows, allow tapping
    setTimeout(() => {
      setIsShowingSequence(false);
      speak('Follow the sequence!');
    }, SEQUENCE_LENGTH * 800 + 500);
  }, [arrowOpacities, arrowScales]);

  const handleLeftHandTap = useCallback(() => {
    if (done || !showSequence || isShowingSequence || currentIndex >= sequence.length) return;
    
    const currentArrow = sequence[currentIndex];
    if (currentArrow.expectedHand === 'left') {
      handleCorrect('left');
    } else {
      handleWrong();
    }
  }, [done, showSequence, isShowingSequence, currentIndex, sequence]);

  const handleRightHandTap = useCallback(() => {
    if (done || !showSequence || isShowingSequence || currentIndex >= sequence.length) return;
    
    const currentArrow = sequence[currentIndex];
    if (currentArrow.expectedHand === 'right') {
      handleCorrect('right');
    } else {
      handleWrong();
    }
  }, [done, showSequence, isShowingSequence, currentIndex, sequence]);

  const handleCorrect = useCallback((hand: 'left' | 'right') => {
    const handScale = hand === 'left' ? leftHandScale : rightHandScale;
    const currentArrow = sequence[currentIndex];
    const opacity = arrowOpacities.get(currentArrow.id)!;
    const scale = arrowScales.get(currentArrow.id)!;
    
    // Animate hand
    Animated.sequence([
      Animated.timing(handScale, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(handScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
    
    // Fade out current arrow
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1.5,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    
    if (nextIndex >= sequence.length) {
      // Sequence complete!
      setScore((s) => s + 1);
      speak('Perfect sequence!');
      
      setTimeout(() => {
        setShowSequence(false);
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          setTimeout(() => generateSequence(), 1000);
        } else {
          endGame();
        }
      }, 1000);
    } else {
      speak('Next!');
    }
  }, [currentIndex, sequence, leftHandScale, rightHandScale, arrowOpacities, arrowScales, round, generateSequence]);

  const handleWrong = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    const currentArrow = sequence[currentIndex];
    speak(`Use ${currentArrow.expectedHand} hand!`);
    
    // Shake animation
    const scale = arrowScales.get(currentArrow.id)!;
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [currentIndex, sequence, arrowScales]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 20; // More XP for sequence games
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowSequence(false);

    try {
      await logGameAndAward({
        type: 'arrow-sequence',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['memory', 'movement', 'sequence-following', 'cross-body-coordination'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      setTimeout(() => {
        generateSequence();
      }, 500);
    }
  }, [showInfo, round, done, generateSequence]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  const getArrowEmoji = (dir: ArrowDirection) => {
    switch (dir) {
      case 'left': return '⬅️';
      case 'right': return '➡️';
      case 'up': return '⬆️';
      case 'down': return '⬇️';
    }
  };

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Arrow Sequence"
        emoji="➡️"
        description="Multiple arrows follow! Remember the sequence!"
        skills={['Memory + movement', 'Sequence following']}
        suitableFor="Children learning to remember and follow sequences with cross-body coordination"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xpAwarded={finalStats.xp}
          onHome={() => {
            stopAllSpeech();
            cleanupSounds();
            onBack?.();
          }}
          onPlayAgain={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            setShowSequence(false);
            setCurrentIndex(0);
            arrowOpacities.forEach((opacity) => opacity.setValue(0));
            arrowScales.forEach((scale) => scale.setValue(1));
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Arrow Sequence</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {isShowingSequence
            ? 'Watch the sequence...'
            : showSequence && currentIndex < sequence.length
            ? `Tap ${sequence[currentIndex]?.expectedHand} hand! (${currentIndex + 1}/${sequence.length})`
            : 'Wait for sequence...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showSequence &&
          sequence.map((arrow) => {
            const opacity = arrowOpacities.get(arrow.id);
            const scale = arrowScales.get(arrow.id);
            
            if (!opacity || !scale) return null;
            
            const isCurrent = currentIndex === arrow.id && !isShowingSequence;
            
            return (
              <Animated.View
                key={arrow.id}
                style={[
                  styles.arrowContainer,
                  {
                    left: arrow.x - ARROW_SIZE / 2,
                    top: arrow.y - ARROW_SIZE / 2,
                    opacity,
                    transform: [{ scale }],
                    borderWidth: isCurrent ? 4 : 0,
                    borderColor: '#10B981',
                  },
                ]}
              >
                <Text style={styles.arrowEmoji}>{getArrowEmoji(arrow.direction)}</Text>
                {isCurrent && (
                  <View style={styles.currentIndicator}>
                    <Text style={styles.currentText}>NOW!</Text>
                  </View>
                )}
              </Animated.View>
            );
          })}

        <View style={styles.handsContainer}>
          <TouchableOpacity
            style={styles.handButton}
            onPress={handleLeftHandTap}
            activeOpacity={0.8}
          >
            <Animated.View
              style={[
                styles.handTarget,
                styles.leftHand,
                { transform: [{ scale: leftHandScale }] },
              ]}
            >
              <Text style={styles.handEmoji}>👈</Text>
              <Text style={styles.handLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.handButton}
            onPress={handleRightHandTap}
            activeOpacity={0.8}
          >
            <Animated.View
              style={[
                styles.handTarget,
                styles.rightHand,
                { transform: [{ scale: rightHandScale }] },
              ]}
            >
              <Text style={styles.handEmoji}>👉</Text>
              <Text style={styles.handLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Memory + movement • Sequence following
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 12,
  },
  instruction: {
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '700',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  arrowContainer: {
    position: 'absolute',
    width: ARROW_SIZE,
    height: ARROW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 20,
  },
  arrowEmoji: {
    fontSize: 80,
  },
  currentIndicator: {
    position: 'absolute',
    top: -30,
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  currentText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  handsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
    marginTop: 40,
    position: 'absolute',
    bottom: 100,
  },
  handButton: {
    width: 140,
    height: 140,
  },
  handTarget: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftHand: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightHand: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  handEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  handLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
});

export default ArrowSequenceGame;
