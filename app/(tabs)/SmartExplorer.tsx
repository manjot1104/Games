import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import {
  API_BASE_URL,
  completeSmartExplorerSession,
  fetchSmartSceneDetail,
  fetchSmartScenes,
  SmartSceneDetail,
  SmartSceneSummary,
  startSmartExplorerSession,
  submitSmartExplorerPrompt,
} from '@/utils/api';

function getSceneImageUrl(url: string) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  // Remove leading slash if present to avoid double slashes if API_BASE_URL has one
  const cleanUrl = url.startsWith('/') ? url.slice(1) : url;
  const cleanBase = API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`;
  return `${cleanBase}${cleanUrl}`;
}

type Mode = 'learn' | 'play' | 'therapy';

type SessionState = {
  id: string;
  sceneId: string;
  mode: Mode;
  difficulty: string;
  totalPrompts: number;
  correctPrompts: number;
  score: number;
  accuracy: number;
  ended: boolean;
};

type PromptPayload = {
  _id: string;
  type: string;
  difficulty: string;
  payload?: {
    target_item_ids?: string[];
    targetItemIds?: string[];
    category?: string;
  };
  tts?: any;
};

type RewardSnapshot = {
  xp: number;
  coins: number;
  hearts: number;
  accuracy: number;
  smartExplorer: {
    totalPrompts: number;
    correctPrompts: number;
    accuracy: number;
    bestStreak: number;
    lastPlayedDate: string | null;
  };
};

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function SmartExplorerScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [scenes, setScenes] = useState<SmartSceneSummary[]>([]);
  const [selectedSceneSlug, setSelectedSceneSlug] = useState<string | null>(null);
  const [sceneDetail, setSceneDetail] = useState<SmartSceneDetail | null>(null);
  const [mode, setMode] = useState<Mode>('learn');
  const [session, setSession] = useState<SessionState | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<PromptPayload | null>(null);
  const [rewardSnapshot, setRewardSnapshot] = useState<RewardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [showSupports, setShowSupports] = useState(true);
  const [showTherapyControls, setShowTherapyControls] = useState(false);
  const [summaryModalVisible, setSummaryModalVisible] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(true);

  const promptStartRef = useRef<number>(0);
  const incorrectTapRef = useRef<number>(0);

  const targetIds = useMemo(() => {
    if (!currentPrompt?.payload) return [];
    return (
      currentPrompt.payload.targetItemIds ||
      currentPrompt.payload.target_item_ids ||
      []
    ).map(String);
  }, [currentPrompt]);

  const isTherapyMode = mode === 'therapy';

  const loadScenes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSmartScenes();
      setScenes(data.scenes || []);
    } catch (err) {
      console.error(err);
      setError('Failed to load scenes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  const handleSelectScene = useCallback(
    async (slug: string) => {
      if (selectedSceneSlug === slug && sceneDetail) return;
      try {
        setError(null);
        setSelectedSceneSlug(slug);
        const detail = await fetchSmartSceneDetail(slug);
        setSceneDetail(detail);
        setSession(null);
        setCurrentPrompt(null);
        setRewardSnapshot(null);
      } catch (err) {
        console.error(err);
        setError('Failed to load scene');
      }
    },
    [selectedSceneSlug, sceneDetail],
  );

  const speak = useCallback((line?: string) => {
    if (!line) return;
    try {
      speakTTS(line, 0.98);
    } catch (err) {
      console.warn('TTS error', err);
    }
  }, []);

  const renderModeLabel = (value: Mode) => {
    switch (value) {
      case 'learn':
        return 'Learn';
      case 'play':
        return 'Play';
      case 'therapy':
        return 'Therapy';
      default:
        return value;
    }
  };

  const handleStartSession = useCallback(async () => {
    if (!selectedSceneSlug) return;
    try {
      setError(null);
      const res = await startSmartExplorerSession({ sceneSlug: selectedSceneSlug, mode });
      const sessionPayload: SessionState = {
        id: res.session.id,
        sceneId: res.session.sceneId,
        mode,
        difficulty: res.session.difficulty,
        totalPrompts: 0,
        correctPrompts: 0,
        score: 0,
        accuracy: 0,
        ended: false,
      };
      setSession(sessionPayload);
      setCurrentPrompt(res.prompt);
      incorrectTapRef.current = 0;
      setHintVisible(false);
      promptStartRef.current = Date.now();
      speak(res.prompt?.tts?.prompt?.en || res.prompt?.tts?.prompt);
    } catch (err) {
      console.error(err);
      setError('Failed to start session');
    }
  }, [selectedSceneSlug, mode, speak]);

  useEffect(() => {
    if (currentPrompt?.tts?.prompt?.en) {
      promptStartRef.current = Date.now();
      incorrectTapRef.current = 0;
      speak(currentPrompt.tts.prompt.en);
    }
  }, [currentPrompt, speak]);

  const handleTapItem = useCallback(
    async (itemId: string) => {
      if (!session || !currentPrompt) return;
      const isCorrect = targetIds.includes(itemId);

      if (!isCorrect) {
        incorrectTapRef.current += 1;
        speak(currentPrompt.tts?.retry?.en || 'Try again.');
        return;
      }

      const responseTimeMs = Date.now() - (promptStartRef.current || Date.now());
      speak(currentPrompt.tts?.correct?.en || 'Great! You found it.');

      try {
        const res = await submitSmartExplorerPrompt(session.id, {
          promptId: currentPrompt._id,
          correct: true,
          responseTimeMs,
          incorrectTaps: incorrectTapRef.current,
          hintsUsed: hintVisible ? ['halo'] : [],
          events: [
            {
              event: 'tap',
              correct: true,
              data: { itemId },
            },
          ],
        });

        const updatedSession: SessionState = {
          id: res.session.id,
          sceneId: session.sceneId,
          mode: session.mode,
          difficulty: res.session.difficulty,
          totalPrompts: res.session.totalPrompts,
          correctPrompts: res.session.correctPrompts,
          score: res.session.score,
          accuracy: res.session.accuracy,
          ended: res.session.ended,
        };
        setSession(updatedSession);
        setRewardSnapshot(res.rewardSnapshot);
        setCurrentPrompt(res.nextPrompt || null);
        incorrectTapRef.current = 0;
        setHintVisible(false);

        if (!res.nextPrompt || res.session.ended) {
          setSummaryModalVisible(true);
          await completeSmartExplorerSession(session.id);
        }
      } catch (err) {
        console.error(err);
        setError('Failed to submit prompt');
      }
    },
    [session, currentPrompt, targetIds],
  );

  const handleIncorrectTap = useCallback(
    async (itemId: string) => {
      if (!session || !currentPrompt) return;
      incorrectTapRef.current += 1;
      speak(currentPrompt.tts?.retry?.en || 'Look closely. Try again.');
    },
    [session, currentPrompt, speak],
  );

  const handleHint = useCallback(() => {
    setHintVisible((prev) => !prev);
    if (currentPrompt?.tts?.clue?.en && !hintVisible) {
      speak(currentPrompt.tts.clue.en);
    }
  }, [currentPrompt, speak, hintVisible]);

  const resetSession = useCallback(() => {
    setSession(null);
    setCurrentPrompt(null);
    setRewardSnapshot(null);
    setHintVisible(false);
    incorrectTapRef.current = 0;
    setSummaryModalVisible(false);
  }, []);

  useEffect(() => () => Speech.stop(), []);

  const renderSceneCard = (scene: SmartSceneSummary) => (
    <TouchableOpacity
      key={scene._id}
      style={[
        styles.sceneCard,
        selectedSceneSlug === scene.slug && styles.sceneCardActive,
      ]}
      activeOpacity={0.92}
      onPress={() => handleSelectScene(scene.slug)}
    >
      <Image source={{ uri: getSceneImageUrl(scene.imageUrl) }} style={styles.sceneImage} resizeMode="cover" />
      <View style={styles.sceneInfo}>
        <Text style={styles.sceneTitle}>{scene.title}</Text>
        <Text style={styles.sceneSubtitle}>
          {scene.itemCount} interactive items
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderModeToggle = () => (
    <View style={styles.modeToggle}>
      {(['learn', 'play', 'therapy'] as Mode[]).map((value) => {
        const active = mode === value;
        return (
          <TouchableOpacity
            key={value}
            style={[styles.modeButton, active && styles.modeButtonActive]}
            onPress={() => setMode(value)}
          >
            <Text style={[styles.modeButtonLabel, active && styles.modeButtonLabelActive]}>
              {renderModeLabel(value)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderPromptCard = () => {
    if (!currentPrompt) return null;

    const promptLine =
      currentPrompt.tts?.prompt?.en ||
      currentPrompt.tts?.prompt ||
      'Find the target in the scene.';

    return (
      <LinearGradient
        colors={['#2563EB', '#4F46E5']}
        style={styles.promptCard}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={styles.avatarBubble}>
            <Ionicons name="sparkles" size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.promptTitle}>Scout says…</Text>
            <Text style={styles.promptLine}>{promptLine}</Text>
          </View>
          <TouchableOpacity onPress={() => speak(promptLine)} activeOpacity={0.85}>
            <View style={styles.replayButton}>
              <Ionicons name="volume-high" size={18} color="#1D4ED8" />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.promptMeta}>
          <View style={styles.metaChip}>
            <Ionicons name="flash-outline" size={14} color="#1D4ED8" />
            <Text style={styles.metaChipText}>
              {currentPrompt.difficulty?.replace('tier', 'Tier ')}
            </Text>
          </View>
          <View style={styles.metaChip}>
            <Ionicons name="timer-outline" size={14} color="#1D4ED8" />
            <Text style={styles.metaChipText}>
              {mode === 'learn' ? 'No timer' : 'Timer active'}
            </Text>
          </View>
        </View>
      </LinearGradient>
    );
  };

  const renderSupports = () => (
    <View style={styles.supportBar}>
      <TouchableOpacity
        style={[styles.supportButton, hintVisible && styles.supportButtonActive]}
        onPress={handleHint}
      >
        <Ionicons name="bulb-outline" size={18} color={hintVisible ? '#fff' : '#1F2937'} />
        <Text style={[styles.supportButtonLabel, hintVisible && styles.supportButtonLabelActive]}>
          {hintVisible ? 'Hide Hint' : 'Show Hint'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.supportButton, showSupports && styles.supportButtonActive]}
        onPress={() => setShowSupports((prev) => !prev)}
      >
        <Ionicons name="contrast-outline" size={18} color={showSupports ? '#fff' : '#1F2937'} />
        <Text
          style={[
            styles.supportButtonLabel,
            showSupports && styles.supportButtonLabelActive,
          ]}
        >
          {showSupports ? 'Supports On' : 'Supports Off'}
        </Text>
      </TouchableOpacity>

      {isTherapyMode && (
        <TouchableOpacity
          style={[styles.supportButton, showTherapyControls && styles.supportButtonActive]}
          onPress={() => setShowTherapyControls((prev) => !prev)}
        >
          <Ionicons
            name="settings-outline"
            size={18}
            color={showTherapyControls ? '#fff' : '#1F2937'}
          />
          <Text
            style={[
              styles.supportButtonLabel,
              showTherapyControls && styles.supportButtonLabelActive,
            ]}
          >
            Therapy Controls
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderTherapyControls = () => {
    if (!showTherapyControls || !sceneDetail) return null;

    return (
      <View style={styles.therapyPanel}>
        <Text style={styles.therapyHeading}>Therapy Controls</Text>
        <View style={styles.therapyRow}>
          <Text style={styles.therapyLabel}>Pin Scene</Text>
          <Text style={styles.therapyValue}>{sceneDetail.scene.title}</Text>
        </View>
        <View style={styles.therapyRow}>
          <Text style={styles.therapyLabel}>Current Difficulty</Text>
          <Text style={styles.therapyValue}>{session?.difficulty}</Text>
        </View>
        <View style={styles.therapyHint}>
          <Ionicons name="information-circle-outline" size={18} color="#3B82F6" />
          <Text style={styles.therapyHintText}>
            Tap any item to model the action. Toggle hints to scaffold.
          </Text>
        </View>
      </View>
    );
  };

  const renderSceneCanvas = () => {
    if (!sceneDetail || !currentPrompt) return null;

    const { width } = Dimensions.get('window');
    const imageWidth = Math.min(width - 32, 700);

    return (
      <View style={{ alignItems: 'center', marginTop: 16 }}>
        <View style={[styles.canvasWrapper, { width: imageWidth, aspectRatio: 16 / 9 }]}>
          <Image source={{ uri: getSceneImageUrl(sceneDetail.scene.imageUrl) }} style={styles.canvasImage} />
          {sceneDetail.items.map((item) => {
            const { bbox } = item;
            const left = bbox.x * 100;
            const top = bbox.y * 100;
            const boxWidth = bbox.w * 100;
            const boxHeight = bbox.h * 100;
            const isTarget = targetIds.includes(item._id);

            return (
              <Pressable
                key={item._id}
                onPress={() => {
                  if (isTarget) {
                    handleTapItem(item._id);
                  } else {
                    handleIncorrectTap(item._id);
                  }
                }}
                style={[
                  styles.hitbox,
                  {
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${boxWidth}%`,
                    height: `${boxHeight}%`,
                  },
                ]}
              >
                {showSupports && (hintVisible || isTherapyMode) && isTarget && (
                  <Animated.View entering={FadeInUp} style={styles.hintHalo} />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  const renderSummaryModal = () => {
    if (!session || !sceneDetail) return null;

    return (
      <Modal visible={summaryModalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Session Complete</Text>
            <Text style={styles.modalScene}>{sceneDetail.scene.title}</Text>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Score</Text>
              <Text style={styles.summaryValue}>{session.score}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Accuracy</Text>
              <Text style={styles.summaryValue}>{session.accuracy}%</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Prompts</Text>
              <Text style={styles.summaryValue}>
                {session.correctPrompts}/{session.totalPrompts}
              </Text>
            </View>

            {rewardSnapshot && (
              <View style={styles.rewardContainer}>
                <Text style={styles.rewardHeading}>Updated Stats</Text>
                <View style={styles.rewardRow}>
                  <Ionicons name="star-outline" size={16} color="#F59E0B" />
                  <Text style={styles.rewardText}>XP: {rewardSnapshot.xp}</Text>
                </View>
                <View style={styles.rewardRow}>
                  <Ionicons name="heart-outline" size={16} color="#EF4444" />
                  <Text style={styles.rewardText}>Hearts: {rewardSnapshot.hearts}</Text>
                </View>
                <View style={styles.rewardRow}>
                  <Ionicons name="sparkles-outline" size={16} color="#6366F1" />
                  <Text style={styles.rewardText}>
                    Smart Explorer accuracy: {rewardSnapshot.smartExplorer.accuracy}%
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={() => {
                  setSummaryModalVisible(false);
                  resetSession();
                }}
              >
                <Text style={styles.modalButtonTextSecondary}>Choose Scene</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={() => {
                  setSummaryModalVisible(false);
                  handleStartSession();
                }}
              >
                <Text style={styles.modalButtonTextPrimary}>Play Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingLabel}>Loading Smart Explorer…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.85}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={18} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Smart Explorer</Text>
          <View style={{ width: 40 }} />
        </View>

        <LinearGradient
          colors={['#E0F2FE', '#F5F3FF', '#FFFFFF']}
          style={styles.heroCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Text style={styles.heroEyebrow}>New</Text>
          <Text style={styles.heroHeading}>Discover the world through play</Text>
          <Text style={styles.heroCaption}>
            Tap to explore rich scenes, follow Scout’s prompts, and build receptive language
            skills with adaptive difficulty.
          </Text>
        </LinearGradient>

        {
          showComingSoon && (
            <LinearGradient
              colors={['#EEF2FF', '#FDF2F8']}
              style={styles.comingSoonCard}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.comingSoonIcon}>
                <Ionicons name="sparkles" size={26} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.comingSoonTitle}>Magic in progress ✨</Text>
                <Text style={styles.comingSoonCaption}>
                  Smart Explorer is getting the final touches. You can browse scenes now while we polish the interactive adventures.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowComingSoon(false)}
                activeOpacity={0.85}
                style={styles.comingSoonButton}
              >
                <Text style={styles.comingSoonButtonText}>Got it</Text>
              </TouchableOpacity>
            </LinearGradient>
          )
        }

        {
          error && (
            <View style={styles.errorBanner}>
              <Ionicons name="warning-outline" size={18} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )
        }

        <Text style={styles.sectionHeading}>Choose a Scene</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
          {scenes.map(renderSceneCard)}
        </ScrollView>

        {
          sceneDetail && (
            <>
              <Text style={styles.sectionHeading}>Select Mode</Text>
              {renderModeToggle()}

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleStartSession}
                activeOpacity={0.9}
              >
                <Ionicons name="play" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryButtonLabel}>Start Session</Text>
              </TouchableOpacity>
            </>
          )
        }

        {
          session && (
            <>
              <View style={styles.statsStrip}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Score</Text>
                  <Text style={styles.statValue}>{session.score}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Accuracy</Text>
                  <Text style={styles.statValue}>{session.accuracy}%</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Prompts</Text>
                  <Text style={styles.statValue}>
                    {session.correctPrompts}/{session.totalPrompts}
                  </Text>
                </View>
              </View>

              {renderPromptCard()}
              {renderSupports()}
              {renderTherapyControls()}
              {renderSceneCanvas()}
            </>
          )
        }
      </ScrollView>

      {renderSummaryModal()}
    </SafeAreaView >
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  loadingLabel: {
    marginTop: 12,
    color: '#1F2937',
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  heroCard: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 24,
  },
  comingSoonCard: {
    borderRadius: 22,
    padding: 16,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#E0E7FF',
    shadowColor: '#312E81',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  comingSoonIcon: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: 'rgba(124,58,237,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  comingSoonTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#4C1D95',
    marginBottom: 4,
  },
  comingSoonCaption: {
    color: '#5B21B6',
    fontWeight: '600',
    lineHeight: 18,
  },
  comingSoonButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    marginLeft: 12,
    marginTop: 4,
    backgroundColor: '#FFFFFF',
  },
  comingSoonButtonText: {
    color: '#7C3AED',
    fontWeight: '800',
  },
  heroEyebrow: {
    color: '#1D4ED8',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  heroHeading: {
    fontSize: 24,
    fontWeight: '900',
    color: '#111827',
    marginTop: 6,
  },
  heroCaption: {
    fontSize: 14,
    lineHeight: 20,
    color: '#1F2937',
    marginTop: 12,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
  },
  sceneCard: {
    width: SCREEN_WIDTH * 0.7,
    maxWidth: 360,
    marginRight: 16,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  sceneCardActive: {
    borderColor: '#2563EB',
    shadowOpacity: 0.2,
  },
  sceneImage: {
    width: '100%',
    height: 160,
  },
  sceneInfo: {
    padding: 16,
  },
  sceneTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  sceneSubtitle: {
    marginTop: 4,
    color: '#475569',
  },
  modeToggle: {
    flexDirection: 'row',
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
    padding: 4,
    marginBottom: 16,
  },
  modeButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#2563EB',
  },
  modeButtonLabel: {
    fontWeight: '600',
    color: '#1F2937',
  },
  modeButtonLabelActive: {
    color: '#fff',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: '#2563EB',
    marginBottom: 24,
  },
  primaryButtonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  statsStrip: {
    flexDirection: 'row',
    borderRadius: 18,
    backgroundColor: '#E2E8F0',
    padding: 16,
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  statValue: {
    marginTop: 6,
    fontWeight: '800',
    fontSize: 16,
    color: '#0F172A',
  },
  promptCard: {
    borderRadius: 24,
    padding: 20,
    marginTop: 8,
  },
  avatarBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginRight: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptTitle: {
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  promptLine: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 6,
    fontWeight: '600',
  },
  promptMeta: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 10,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  metaChipText: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  replayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  supportBar: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    flexWrap: 'wrap',
  },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
  },
  supportButtonActive: {
    backgroundColor: '#2563EB',
  },
  supportButtonLabel: {
    color: '#1F2937',
    fontWeight: '600',
  },
  supportButtonLabelActive: {
    color: '#fff',
  },
  therapyPanel: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
    padding: 16,
  },
  therapyHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  therapyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  therapyLabel: {
    color: '#475569',
    fontWeight: '600',
  },
  therapyValue: {
    color: '#0F172A',
    fontWeight: '700',
  },
  therapyHint: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  therapyHintText: {
    flex: 1,
    color: '#3B82F6',
    fontWeight: '600',
  },
  canvasWrapper: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  canvasImage: {
    width: '100%',
    height: '100%',
  },
  hitbox: {
    position: 'absolute',
  },
  hintHalo: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(59,130,246,0.8)',
    backgroundColor: 'rgba(59,130,246,0.15)',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalScene: {
    marginTop: 4,
    color: '#475569',
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  summaryLabel: {
    color: '#1F2937',
    fontWeight: '600',
  },
  summaryValue: {
    color: '#111827',
    fontWeight: '800',
  },
  rewardContainer: {
    marginTop: 20,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    padding: 14,
  },
  rewardHeading: {
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  rewardText: {
    color: '#1F2937',
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  modalButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonSecondary: {
    backgroundColor: '#E2E8F0',
  },
  modalButtonPrimary: {
    backgroundColor: '#2563EB',
  },
  modalButtonTextSecondary: {
    color: '#1F2937',
    fontWeight: '700',
  },
  modalButtonTextPrimary: {
    color: '#fff',
    fontWeight: '700',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    marginBottom: 16,
  },
  errorText: {
    color: '#B91C1C',
    fontWeight: '600',
  },
});

