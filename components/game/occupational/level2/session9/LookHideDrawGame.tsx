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
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const SHOW_DURATION = 3000; // 3 seconds to view pattern
const HIDE_DURATION = 2000; // 2 seconds hidden

type PatternType = 'circle' | 'square' | 'triangle' | 'cross' | 'plus';

interface Pattern {
  type: PatternType;
  path: string;
}

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

const generatePattern = (): Pattern => {
  const patterns: Pattern[] = [
    { type: 'circle', path: 'M 50 30 A 10 10 0 1 1 50 50 A 10 10 0 1 1 50 30' },
    { type: 'square', path: 'M 40 30 L 60 30 L 60 50 L 40 50 Z' },
    { type: 'triangle', path: 'M 50 30 L 60 50 L 40 50 Z' },
    { type: 'cross', path: 'M 50 30 L 50 50 M 40 40 L 60 40' },
    { type: 'plus', path: 'M 50 35 L 50 45 M 45 40 L 55 40' },
  ];
  return patterns[Math.floor(Math.random() * patterns.length)];
};

const LookHideDrawGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playWarning = useSoundEffect(WARNING_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [phase, setPhase] = useState<'show' | 'hide' | 'draw'>('show');
  const [targetPattern, setTargetPattern] = useState<Pattern | null>(null);
  const [userPattern, setUserPattern] = useState<PatternType | null>(null);
  const patternOpacity = useSharedValue(1);
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
          type: 'lookHideDraw',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['visual-memory', 'reproduction', 'pattern-copying'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log look hide draw game:', e);
      }

      speakTTS('Pattern remembered!', 0.78 );
    },
    [router],
  );

  const handlePatternSelect = useCallback((type: PatternType) => {
    if (!roundActive || done || phase !== 'draw' || !targetPattern) return;
    
    setUserPattern(type);
    const isCorrect = type === targetPattern.type;

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
            setUserPattern(null);
            setPhase('show');
            patternOpacity.value = 1;
            setRoundActive(false);
          }, 1500);
        }
        return newScore;
      });

      try {
        playSuccess();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } else {
      setUserPattern(null);
      try {
        playWarning();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        speakTTS('Try again!', 0.78 );
      } catch {}
    }
  }, [roundActive, done, phase, targetPattern, endGame, playSuccess, playWarning, sparkleX, sparkleY, patternOpacity]);

  useEffect(() => {
    const pattern = generatePattern();
    setTargetPattern(pattern);
    setUserPattern(null);
    setPhase('show');
    patternOpacity.value = 1;
    setRoundActive(false);

    try {
      speakTTS('Look at the pattern carefully', 0.78 );
    } catch {}

    // Show pattern
    const showTimer = setTimeout(() => {
      setPhase('hide');
      patternOpacity.value = withTiming(0, { duration: 300 });
      try {
        speakTTS('Pattern is hidden. Remember it!', 0.78 );
      } catch {}
    }, SHOW_DURATION);

    // Hide pattern
    const hideTimer = setTimeout(() => {
      setPhase('draw');
      setRoundActive(true);
      try {
        speakTTS('Now select the pattern you saw!', 0.78 );
      } catch {}
    }, SHOW_DURATION + HIDE_DURATION);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round, patternOpacity]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  const renderPattern = (pattern: Pattern | null) => {
    if (!pattern) return null;

    if (pattern.type === 'circle') {
      return <Circle cx="50" cy="40" r="10" fill="none" stroke="#64748B" strokeWidth="3" />;
    } else if (pattern.type === 'square') {
      return <Rect x="40" y="30" width="20" height="20" fill="none" stroke="#64748B" strokeWidth="3" />;
    } else if (pattern.type === 'triangle') {
      return <Path d="M 50 30 L 60 50 L 40 50 Z" fill="none" stroke="#64748B" strokeWidth="3" />;
    } else if (pattern.type === 'cross') {
      return (
        <>
          <Line x1="50" y1="30" x2="50" y2="50" stroke="#64748B" strokeWidth="3" strokeLinecap="round" />
          <Line x1="40" y1="40" x2="60" y2="40" stroke="#64748B" strokeWidth="3" strokeLinecap="round" />
        </>
      );
    } else if (pattern.type === 'plus') {
      return (
        <>
          <Line x1="50" y1="35" x2="50" y2="45" stroke="#64748B" strokeWidth="3" strokeLinecap="round" />
          <Line x1="45" y1="40" x2="55" y2="40" stroke="#64748B" strokeWidth="3" strokeLinecap="round" />
        </>
      );
    }
    return null;
  };

  const patternStyle = useAnimatedStyle(() => ({
    opacity: patternOpacity.value,
  }));

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>👁️</Text>
            <Text style={styles.resultTitle}>Patterns Remembered!</Text>
            <Text style={styles.resultSubtitle}>
              You remembered {finalStats.correct} patterns out of {finalStats.total}!
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
                setRoundActive(false);
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const availablePatterns: PatternType[] = ['circle', 'square', 'triangle', 'cross', 'plus'];

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Look–Hide–Draw</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 👁️ Score: {score}
        </Text>
        <Text style={styles.helper}>
          {phase === 'show' && 'Look at the pattern carefully...'}
          {phase === 'hide' && 'Pattern is hidden. Remember it!'}
          {phase === 'draw' && 'Now select the pattern you saw!'}
        </Text>
      </View>

      <View style={styles.playArea}>
        <View style={styles.patternSection}>
          <Text style={styles.sectionTitle}>
            {phase === 'show' ? 'Look carefully:' : phase === 'hide' ? 'Hidden' : 'What did you see?'}
          </Text>
          <View style={styles.patternBox}>
            <Animated.View style={[styles.patternContainer, patternStyle]}>
              <Svg width="100%" height="80" viewBox="0 0 100 80" preserveAspectRatio="xMidYMid meet">
                {renderPattern(phase === 'show' ? targetPattern : null)}
                {phase === 'draw' && userPattern && renderPattern({ type: userPattern, path: '' })}
              </Svg>
            </Animated.View>
          </View>
        </View>

        {phase === 'draw' && (
          <View style={styles.controlsSection}>
            <Text style={styles.controlsTitle}>Select the pattern:</Text>
            <View style={styles.controlsRow}>
              {availablePatterns.map((patternType) => (
                <TouchableOpacity
                  key={patternType}
                  style={[
                    styles.patternButton,
                    userPattern === patternType && styles.patternButtonSelected,
                  ]}
                  onPress={() => handlePatternSelect(patternType)}
                  disabled={!roundActive || done}
                >
                  <Svg width="40" height="40" viewBox="0 0 100 80">
                    {renderPattern({ type: patternType, path: '' })}
                  </Svg>
                  <Text style={styles.patternButtonLabel}>
                    {patternType.charAt(0).toUpperCase() + patternType.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

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
          Remember the pattern when it disappears!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FDF4FF',
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
    minHeight: 150,
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  patternContainer: {
    width: '100%',
    height: '100%',
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
    gap: 12,
    flexWrap: 'wrap',
  },
  patternButton: {
    width: 80,
    height: 100,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  patternButtonSelected: {
    borderColor: '#8B5CF6',
    backgroundColor: '#F3E8FF',
  },
  patternButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
    marginTop: 8,
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

export default LookHideDrawGame;

