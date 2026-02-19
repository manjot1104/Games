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
} from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;

type StrokeType = 'vertical' | 'horizontal' | 'diagonal-down' | 'diagonal-up' | 'circle';

interface Stroke {
  type: StrokeType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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

const generatePattern = (): Stroke[] => {
  const patterns: Stroke[][] = [
    [
      { type: 'vertical', x1: 40, y1: 30, x2: 40, y2: 50 },
      { type: 'horizontal', x1: 30, y1: 40, x2: 50, y2: 40 },
    ],
    [
      { type: 'diagonal-down', x1: 35, y1: 30, x2: 45, y2: 50 },
      { type: 'diagonal-up', x1: 45, y1: 30, x2: 35, y2: 50 },
    ],
    [
      { type: 'vertical', x1: 35, y1: 30, x2: 35, y2: 50 },
      { type: 'vertical', x1: 45, y1: 30, x2: 45, y2: 50 },
      { type: 'horizontal', x1: 35, y1: 40, x2: 45, y2: 40 },
    ],
    [
      { type: 'horizontal', x1: 30, y1: 35, x2: 50, y2: 35 },
      { type: 'horizontal', x1: 30, y1: 45, x2: 50, y2: 45 },
      { type: 'vertical', x1: 40, y1: 35, x2: 40, y2: 45 },
    ],
    [
      { type: 'diagonal-down', x1: 30, y1: 30, x2: 50, y2: 50 },
    ],
    [
      { type: 'diagonal-up', x1: 50, y1: 30, x2: 30, y2: 50 },
    ],
  ];
  return patterns[Math.floor(Math.random() * patterns.length)];
};

const StickDesignCopyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playWarning = useSoundEffect(WARNING_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [targetPattern, setTargetPattern] = useState<Stroke[]>([]);
  const [userPattern, setUserPattern] = useState<Stroke[]>([]);
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
          type: 'stickDesignCopy',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['visual-memory', 'reproduction', 'pre-writing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log stick design copy game:', e);
      }

      speakTTS('Design copied!', 0.78 );
    },
    [router],
  );

  const handleStrokeSelect = useCallback((type: StrokeType) => {
    if (!roundActive || done) return;
    
    if (userPattern.length < targetPattern.length) {
      const targetStroke = targetPattern[userPattern.length];
      const newStroke: Stroke = {
        type,
        x1: targetStroke.x1,
        y1: targetStroke.y1,
        x2: targetStroke.x2,
        y2: targetStroke.y2,
      };
      
      if (type === 'vertical') {
        newStroke.x2 = newStroke.x1;
        newStroke.y2 = newStroke.y1 + 20;
      } else if (type === 'horizontal') {
        newStroke.y2 = newStroke.y1;
        newStroke.x2 = newStroke.x1 + 20;
      } else if (type === 'diagonal-down') {
        newStroke.x2 = newStroke.x1 + 10;
        newStroke.y2 = newStroke.y1 + 20;
      } else if (type === 'diagonal-up') {
        newStroke.x2 = newStroke.x1 - 10;
        newStroke.y2 = newStroke.y1 + 20;
      }

      const newPattern = [...userPattern, newStroke];
      setUserPattern(newPattern);

      if (newPattern.length === targetPattern.length) {
        const isCorrect = newPattern.every((stroke, i) => stroke.type === targetPattern[i].type);
        
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
      speakTTS('Copy the pre-writing stroke design!', 0.78 );
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

  const renderStroke = (stroke: Stroke, index: number, isTarget: boolean) => {
    const strokeColor = isTarget ? '#64748B' : '#8B5CF6';
    return (
      <Line
        key={index}
        x1={stroke.x1}
        y1={stroke.y1}
        x2={stroke.x2}
        y2={stroke.y2}
        stroke={strokeColor}
        strokeWidth="3"
        strokeLinecap="round"
      />
    );
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>✏️</Text>
            <Text style={styles.resultTitle}>Designs Copied!</Text>
            <Text style={styles.resultSubtitle}>
              You copied {finalStats.correct} designs out of {finalStats.total}!
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

  const availableStrokes: StrokeType[] = ['vertical', 'horizontal', 'diagonal-down', 'diagonal-up'];

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Stick Design Copy</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ✏️ Score: {score}
        </Text>
        <Text style={styles.helper}>
          Copy the pre-writing stroke design!
        </Text>
      </View>

      <View style={styles.playArea}>
        <View style={styles.patternSection}>
          <Text style={styles.sectionTitle}>Copy this design:</Text>
          <View style={styles.patternBox}>
            <Svg width="100%" height="80" viewBox="0 0 100 80" preserveAspectRatio="xMidYMid meet">
              {targetPattern.map((stroke, i) => renderStroke(stroke, i, true))}
            </Svg>
          </View>
        </View>

        <View style={styles.patternSection}>
          <Text style={styles.sectionTitle}>Your design:</Text>
          <View style={styles.patternBox}>
            <Svg width="100%" height="80" viewBox="0 0 100 80" preserveAspectRatio="xMidYMid meet">
              {userPattern.map((stroke, i) => renderStroke(stroke, i, false))}
            </Svg>
          </View>
        </View>

        <View style={styles.controlsSection}>
          <Text style={styles.controlsTitle}>Tap to add:</Text>
          <View style={styles.controlsRow}>
            {availableStrokes.map((strokeType) => (
              <TouchableOpacity
                key={strokeType}
                style={styles.strokeButton}
                onPress={() => handleStrokeSelect(strokeType)}
                disabled={!roundActive || done || userPattern.length >= targetPattern.length}
              >
                <Svg width="30" height="30" viewBox="0 0 30 30">
                  {strokeType === 'vertical' && (
                    <Line x1="15" y1="5" x2="15" y2="25" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" />
                  )}
                  {strokeType === 'horizontal' && (
                    <Line x1="5" y1="15" x2="25" y2="15" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" />
                  )}
                  {strokeType === 'diagonal-down' && (
                    <Line x1="8" y1="8" x2="22" y2="22" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" />
                  )}
                  {strokeType === 'diagonal-up' && (
                    <Line x1="22" y1="8" x2="8" y2="22" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" />
                  )}
                </Svg>
                <Text style={styles.strokeButtonLabel}>
                  {strokeType.replace('-', ' ')}
                </Text>
              </TouchableOpacity>
            ))}
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
          Skills: visual memory • reproduction • pre-writing strokes
        </Text>
        <Text style={styles.footerSub}>
          Look at the design and copy it!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEFCE8',
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
    gap: 12,
    flexWrap: 'wrap',
  },
  strokeButton: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  strokeButtonLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
    marginTop: 4,
    textTransform: 'capitalize',
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

export default StickDesignCopyGame;

