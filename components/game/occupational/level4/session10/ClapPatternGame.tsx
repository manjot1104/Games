import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
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
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BEAT_INTERVAL = 600;
const TOLERANCE = 250; // Timing tolerance in ms

type ClapSide = 'left' | 'right';

const PATTERNS: ClapSide[][] = [
  ['left', 'right'],
  ['left', 'right', 'left'],
  ['right', 'left', 'right'],
  ['left', 'left', 'right', 'right'],
  ['right', 'right', 'left', 'left'],
  ['left', 'right', 'left', 'right'],
  ['right', 'left', 'right', 'left', 'right'],
  ['left', 'right', 'right', 'left', 'left', 'right'],
];

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

const ClapPatternGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [phase, setPhase] = useState<'listen' | 'copy'>('listen');
  const [pattern, setPattern] = useState<ClapSide[]>([]);
  const [userPattern, setUserPattern] = useState<{ time: number; side: ClapSide }[]>([]);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const leftHandScale = useRef(new Animated.Value(1)).current;
  const rightHandScale = useRef(new Animated.Value(1)).current;
  const beatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const patternStartTime = useRef(0);

  const playPattern = useCallback((patternToPlay: ClapSide[]) => {
    setIsPlaying(true);
    setPhase('listen');
    setCurrentBeat(0);
    patternStartTime.current = Date.now();
    
    let beatIndex = 0;
    
    const playNextBeat = () => {
      if (beatIndex >= patternToPlay.length) {
        setIsPlaying(false);
        setPhase('copy');
        setUserPattern([]);
        patternStartTime.current = Date.now();
        speak('Now copy the pattern!');
        return;
      }
      
      const side = patternToPlay[beatIndex];
      const handScale = side === 'left' ? rightHandScale : leftHandScale; // Cross-body!
      
      // Visual feedback
      Animated.sequence([
        Animated.timing(handScale, {
          toValue: 1.3,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(handScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
      
      playSound('clap', 0.8, 1.0);
      setCurrentBeat(beatIndex + 1);
      
      beatIndex++;
      if (beatIndex < patternToPlay.length) {
        beatTimeoutRef.current = setTimeout(playNextBeat, BEAT_INTERVAL) as any;
      } else {
        beatTimeoutRef.current = setTimeout(() => {
          setIsPlaying(false);
          setPhase('copy');
          setUserPattern([]);
          patternStartTime.current = Date.now();
          speak('Now copy the pattern!');
        }, BEAT_INTERVAL) as any;
      }
    };
    
    speak('Listen to the clap pattern!');
    setTimeout(() => playNextBeat(), 500);
  }, [leftHandScale, rightHandScale]);

  const handleLeftClap = useCallback(() => {
    if (phase !== 'copy' || done) return;
    
    const now = Date.now();
    const relativeTime = now - patternStartTime.current;
    
    setUserPattern((prev) => {
      const newPattern = [...prev, { time: relativeTime, side: 'left' }];
      
      if (newPattern.length === pattern.length) {
        // Check if pattern matches (both timing and side)
        let matches = true;
        for (let i = 0; i < pattern.length; i++) {
          const expectedTime = i * BEAT_INTERVAL;
          const actualTime = newPattern[i].time;
          const expectedSide = pattern[i];
          const actualSide = newPattern[i].side;
          
          if (Math.abs(actualTime - expectedTime) > TOLERANCE || actualSide !== expectedSide) {
            matches = false;
            break;
          }
        }
        
        if (matches) {
          setScore((s) => s + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speak('Perfect!');
          
          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              const newPattern = PATTERNS[(round % PATTERNS.length)];
              setPattern(newPattern);
              playPattern(newPattern);
            } else {
              endGame();
            }
          }, 1000);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          speak('Try again!');
          setUserPattern([]);
          patternStartTime.current = Date.now();
        }
      }
      
      return newPattern;
    });
    
    // Visual feedback
    Animated.sequence([
      Animated.timing(rightHandScale, {
        toValue: 1.3,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(rightHandScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
    
    playSound('clap', 0.6, 1.0);
  }, [phase, done, pattern, round, rightHandScale, playPattern]);

  const handleRightClap = useCallback(() => {
    if (phase !== 'copy' || done) return;
    
    const now = Date.now();
    const relativeTime = now - patternStartTime.current;
    
    setUserPattern((prev) => {
      const newPattern = [...prev, { time: relativeTime, side: 'right' }];
      
      if (newPattern.length === pattern.length) {
        // Check if pattern matches (both timing and side)
        let matches = true;
        for (let i = 0; i < pattern.length; i++) {
          const expectedTime = i * BEAT_INTERVAL;
          const actualTime = newPattern[i].time;
          const expectedSide = pattern[i];
          const actualSide = newPattern[i].side;
          
          if (Math.abs(actualTime - expectedTime) > TOLERANCE || actualSide !== expectedSide) {
            matches = false;
            break;
          }
        }
        
        if (matches) {
          setScore((s) => s + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speak('Perfect!');
          
          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              const newPattern = PATTERNS[(round % PATTERNS.length)];
              setPattern(newPattern);
              playPattern(newPattern);
            } else {
              endGame();
            }
          }, 1000);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          speak('Try again!');
          setUserPattern([]);
          patternStartTime.current = Date.now();
        }
      }
      
      return newPattern;
    });
    
    // Visual feedback
    Animated.sequence([
      Animated.timing(leftHandScale, {
        toValue: 1.3,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(leftHandScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
    
    playSound('clap', 0.6, 1.0);
  }, [phase, done, pattern, round, leftHandScale, playPattern]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 20;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsPlaying(false);
    
    if (beatTimeoutRef.current) {
      clearTimeout(beatTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'clap-pattern',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['rhythm', 'midline', 'cross-body-coordination', 'pattern-copying'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done) {
      const newPattern = PATTERNS[(round - 1) % PATTERNS.length];
      setPattern(newPattern);
      setTimeout(() => playPattern(newPattern), 500);
    }
  }, [showInfo, round, done, playPattern]);

  useEffect(() => {
    return () => {
      if (beatTimeoutRef.current) {
        clearTimeout(beatTimeoutRef.current);
      }
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Clap Pattern"
        emoji="👏"
        description="Cross-body clap copy! Rhythm + midline!"
        skills={['Rhythm + midline', 'Cross-body coordination', 'Pattern copying']}
        suitableFor="Children learning cross-body clapping patterns and rhythm"
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
            setPhase('listen');
            setUserPattern([]);
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
        <Text style={styles.title}>Clap Pattern</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {phase === 'listen'
            ? `Listen... (${currentBeat}/${pattern.length})`
            : `Copy the pattern! (${userPattern.length}/${pattern.length})`}
        </Text>
      </View>

      <View style={styles.gameArea}>
        <View style={styles.handsContainer}>
          <TouchableOpacity
            style={styles.handButton}
            onPress={handleLeftClap}
            activeOpacity={0.8}
            disabled={phase === 'listen'}
          >
            <Animated.View
              style={[
                styles.hand,
                styles.leftHand,
                { transform: [{ scale: rightHandScale }] }, // Cross-body!
              ]}
            >
              <Text style={styles.handEmoji}>👏</Text>
              <Text style={styles.handLabel}>LEFT CLAP</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.handButton}
            onPress={handleRightClap}
            activeOpacity={0.8}
            disabled={phase === 'listen'}
          >
            <Animated.View
              style={[
                styles.hand,
                styles.rightHand,
                { transform: [{ scale: leftHandScale }] }, // Cross-body!
              ]}
            >
              <Text style={styles.handEmoji}>👏</Text>
              <Text style={styles.handLabel}>RIGHT CLAP</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Rhythm + midline • Cross-body coordination • Pattern copying
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
  handsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  handButton: {
    width: 160,
    height: 160,
  },
  hand: {
    width: 160,
    height: 160,
    borderRadius: 80,
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
    fontSize: 60,
    marginBottom: 8,
  },
  handLabel: {
    fontSize: 16,
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

export default ClapPatternGame;
