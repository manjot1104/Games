import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue
} from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const PATTERN_SIZE = 8;
const MATCH_TOLERANCE = 3;

type Pattern = 'vertical' | 'horizontal';

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

const generatePattern = (): Pattern[] => {
  const patterns: Pattern[][] = [
    ['vertical', 'horizontal', 'vertical', 'horizontal'],
    ['horizontal', 'vertical', 'horizontal'],
    ['vertical', 'vertical', 'horizontal'],
    ['horizontal', 'horizontal', 'vertical'],
    ['vertical', 'horizontal', 'horizontal', 'vertical'],
    ['horizontal', 'vertical', 'vertical', 'horizontal'],
  ];
  return patterns[Math.floor(Math.random() * patterns.length)];
};

const CopyTheLinePatternGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playWarning = useSoundEffect(WARNING_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [targetPattern, setTargetPattern] = useState<Pattern[]>([]);
  const [userPattern, setUserPattern] = useState<Pattern[]>([]);
  const sparkleX = useSharedValue(50);
  const sparkleY = useSharedValue(50);

  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 20;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'copyLinePattern',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['visual-memory', 'reproduction', 'pattern-copying'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log copy line pattern game:', e);
      }

      speakTTS('Pattern copied!', 0.78 );
    },
    [router],
  );


  const handlePatternTypeSelect = useCallback((type: Pattern) => {
    if (!roundActive || done) return;
    
    if (userPattern.length < targetPattern.length) {
      const newPattern = [...userPattern, type];
      setUserPattern(newPattern);

      if (newPattern.length === targetPattern.length) {
        const isCorrect = newPattern.every((p, i) => p === targetPattern[i]);
        
        if (isCorrect) {
          sparkleX.value = 50;
          sparkleY.value = 50;
          setScore(s => {
            const newScore = s + 1;
            if (newScore >= TOTAL_ROUNDS) {
              setTimeout(() => {
                endGame(newScore);
              }, 1000);
            } else {
              setTimeout(() => {
                setRound(r => r + 1);
                const pattern = generatePattern();
                setTargetPattern(pattern);
                setUserPattern([]);
                setRoundActive(true);
              }, 1500);
            }
            return newScore;
          });

          try {
            playSuccess();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {}
        } else {
          setTimeout(() => {
            setUserPattern([]);
            try {
              playWarning();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              speakTTS('Try again!', 0.78 );
            } catch {}
          }, 500);
        }
      }
    }
  }, [roundActive, done, userPattern, targetPattern, endGame, playSuccess, playWarning, sparkleX, sparkleY]);

  useEffect(() => {
    const pattern = generatePattern();
    setTargetPattern(pattern);
    setUserPattern([]);
    setRoundActive(true);
    try {
      speakTTS('Copy the pattern by tapping vertical or horizontal lines!', 0.78 );
    } catch {}
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  const renderPatternLine = (type: Pattern, index: number, isTarget: boolean) => {
    const centerX = 50;
    const startY = 30 + index * 15;
    const lineColor = isTarget ? '#64748B' : userPattern[index] === type ? '#8B5CF6' : '#E2E8F0';
    
    if (type === 'vertical') {
      return (
        <Line
          key={index}
          x1={centerX}
          y1={startY - 3}
          x2={centerX}
          y2={startY + 3}
          stroke={lineColor}
          strokeWidth="3"
          strokeLinecap="round"
        />
      );
    } else {
      return (
        <Line
          key={index}
          x1={centerX - 3}
          y1={startY}
          x2={centerX + 3}
          y2={startY}
          stroke={lineColor}
          strokeWidth="3"
          strokeLinecap="round"
        />
      );
    }
  };

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  if (done && finalStats) {
    const accuracyPct = Math.round((finalStats.correct / finalStats.total) * 100);
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <View style={styles.resultCard}>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>📋</Text>
            <Text style={styles.resultTitle}>Patterns Copied!</Text>
            <Text style={styles.resultSubtitle}>
              You copied {finalStats.correct} patterns out of {finalStats.total}!
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setRoundActive(true);
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Copy the Line Pattern</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 📋 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Copy the pattern by tapping vertical (|) or horizontal (—) lines!
        </Text>
      </View>

      <View style={styles.playArea}>
        <View style={styles.patternSection}>
          <Text style={styles.sectionTitle}>Copy this pattern:</Text>
          <View style={styles.patternBox}>
            <Svg width="100%" height="80" viewBox="0 0 100 80" preserveAspectRatio="xMidYMid meet">
              {targetPattern.map((type, i) => renderPatternLine(type, i, true))}
            </Svg>
          </View>
        </View>

        <View style={styles.patternSection}>
          <Text style={styles.sectionTitle}>Your pattern:</Text>
          <View style={styles.patternBox}>
            <Svg width="100%" height="80" viewBox="0 0 100 80" preserveAspectRatio="xMidYMid meet">
              {targetPattern.map((type, i) => {
                const userType = userPattern[i];
                return renderPatternLine(userType || type, i, false);
              })}
            </Svg>
          </View>
        </View>

        <View style={styles.controlsSection}>
          <Text style={styles.controlsTitle}>Tap to add:</Text>
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[styles.patternButton, { backgroundColor: '#8B5CF6' }]}
              onPress={() => handlePatternTypeSelect('vertical')}
              disabled={!roundActive || done || userPattern.length >= targetPattern.length}
            >
              <Text style={styles.patternButtonText}>|</Text>
              <Text style={styles.patternButtonLabel}>Vertical</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.patternButton, { backgroundColor: '#8B5CF6' }]}
              onPress={() => handlePatternTypeSelect('horizontal')}
              disabled={!roundActive || done || userPattern.length >= targetPattern.length}
            >
              <Text style={styles.patternButtonText}>—</Text>
              <Text style={styles.patternButtonLabel}>Horizontal</Text>
            </TouchableOpacity>
          </View>
        </View>

        {score > 0 && (
          <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
            <SparkleBurst />
          </Animated.View>
        )}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: visual memory • reproduction • pattern copying
        </Text>
        <Text style={styles.footerSub}>
          Look at the pattern and copy it!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF5FF',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    marginBottom: 16,
  },
  patternSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  patternBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  controlsSection: {
    marginTop: 20,
  },
  controlsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
    textAlign: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  patternButton: {
    width: 100,
    height: 100,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  patternButtonText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 4,
  },
  patternButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  resultTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 16,
    textAlign: 'center',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default CopyTheLinePatternGame;

