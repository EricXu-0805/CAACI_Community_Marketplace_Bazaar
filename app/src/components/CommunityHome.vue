<template>
  <!--
    Community home (SPEC 5.2 desktop, 5.3 phone). What each block holds, what is
    left out and where a filler goes all come from buildHomeSections; this
    component only lays the result out. A post is drawn once, so every row
    carries its data-post-id.
  -->
  <view :class="['ch', desktop ? 'ch-d' : 'ch-m']">
    <view class="ch-wrap">
      <view v-if="!isLoggedIn && !guestClosed" class="ch-guest">
        <text class="ch-guest-t">{{ t('app.tagline') }}</text>
        <text class="ch-btn-line" role="button" @click="emit('login')">{{ t('home.join') }}</text>
        <view class="ch-guest-x" role="button" :aria-label="t('home.dismiss')" @click="closeGuest">
          <UIcon name="close" size="xs" color="ink-quiet" />
        </view>
      </view>

      <view v-if="failed && !ready" class="ch-state" role="alert" aria-live="assertive" aria-atomic="true">
        <text class="ch-state-t">{{ t('plaza.loadFailed') }}</text>
        <text class="ch-btn-line" role="button" @click="emit('retry')">{{ t('plaza.retry') }}</text>
      </view>

      <template v-else>
        <!-- Phone: the start-here list folds into one bar above the boards. -->
        <view v-if="!desktop && ready && sections.newHere" class="ch-sec" data-block="start-here">
          <view class="ch-fold" role="button" :aria-expanded="startOpen ? 'true' : 'false'" @click="startOpen = !startOpen">
            <text class="ch-fold-t">{{ t('home.startHereFold', { n: sections.newHere.length }) }}</text>
          </view>
          <template v-if="startOpen">
            <view v-for="row in sections.newHere" :key="row.post.id" class="ch-guide" role="button"
              :data-post-id="row.post.id" @click="openPost(row.post.id)">
              <text class="ch-guide-t">{{ row.post.title }}</text>
            </view>
          </template>
        </view>

        <view class="ch-cols">
          <view class="ch-main">
            <view class="ch-grid">
              <template v-for="card in sections.cards" :key="card.kind === 'board' ? card.category : 'market'">
                <view v-if="card.kind === 'board'" class="ch-card" data-block="board" :data-board="card.category">
                  <view class="ch-card-h">
                    <view class="ch-bar"></view>
                    <text class="ch-bname" role="heading" aria-level="2">{{ tx(card.title) }}</text>
                    <text v-if="desktop && card.weeklyLabel" class="ch-week">{{ tx(card.weeklyLabel) }}</text>
                    <text class="ch-link" role="button" :aria-label="`${tx(card.title)} ${t(desktop ? 'home.seeAll' : 'home.more')}`"
                      @click="emit('board', card.category)">{{ t(desktop ? 'home.seeAll' : 'home.more') }}</text>
                  </view>
                  <text v-if="desktop" class="ch-desc">{{ tx(card.description) }}</text>
                  <view class="ch-rows">
                    <template v-if="!ready">
                      <view v-for="n in (desktop ? 4 : 3)" :key="n" class="ch-row ch-row-sk"><view :class="['ch-sk', 'u-sk', { 'ch-sk-short': n % 2 === 0 }]"></view></view>
                    </template>
                    <template v-for="(row, i) in (ready ? card.rows : [])" :key="row.kind === 'post' ? row.post.id : `fill-${i}`">
                      <view v-if="row.kind === 'post'" class="ch-row" role="button" :data-post-id="row.post.id"
                        :aria-label="rowLabel(row)" @click="openPost(row.post.id)">
                        <template v-if="desktop">
                          <text v-if="row.post.is_pinned" class="ch-tag">{{ t('plaza.pinned') }}</text>
                          <text class="ch-row-t">{{ row.post.title }}</text>
                          <text v-if="row.unanswered" class="ch-tag ch-tag-ask">{{ t('plaza.unansweredTag') }}</text>
                          <view class="ch-row-m">
                            <text v-if="row.replyCount" class="ch-cnt">{{ row.replyCount }}</text>
                            <text class="ch-mi">{{ tx(row.time) }}</text>
                          </view>
                        </template>
                        <template v-else>
                          <text class="ch-row-t">{{ row.post.title }}</text>
                          <view class="ch-meta">
                            <text v-if="row.post.is_pinned" class="ch-tag">{{ t('plaza.pinned') }}</text>
                            <text v-if="row.replyCount" class="ch-mi">{{ t('plaza.commentCount', { count: row.replyCount }) }}</text>
                            <text v-else-if="row.unanswered" class="ch-tag ch-tag-ask">{{ t('plaza.unansweredTag') }}</text>
                            <text v-if="row.replyCount || row.unanswered" class="ch-mi">·</text>
                            <text class="ch-mi">{{ tx(row.time) }}</text>
                          </view>
                        </template>
                      </view>
                      <view v-else class="ch-row ch-fill" role="button" @click="emit('compose', card.category)">
                        <text class="ch-fill-t">{{ tx(row.text) }}</text>
                      </view>
                    </template>
                  </view>
                </view>

                <view v-else class="ch-card ch-card-market" data-block="market">
                  <view class="ch-card-h">
                    <view class="ch-bar"></view>
                    <text class="ch-bname" role="heading" aria-level="2">{{ tx(card.title) }}</text>
                    <text class="ch-link" role="button" @click="openMarket">{{ t('home.allMarket') }}</text>
                  </view>
                  <!-- Desktop: three rows. Phone: a strip of cards that scrolls sideways. -->
                  <view v-if="desktop" class="ch-rows">
                    <template v-if="!ready">
                      <view v-for="n in 3" :key="n" class="ch-item ch-row-sk"><view :class="['ch-sk', 'u-sk', { 'ch-sk-short': n % 2 === 0 }]"></view></view>
                    </template>
                    <template v-else>
                      <view v-for="item in card.items" :key="item.id" class="ch-item" role="button"
                        :aria-label="`${itemTitle(item)} ${itemPrice(item)}`" @click="openItem(item.id)">
                        <image v-if="itemThumb(item)" class="ch-thumb" :src="itemThumb(item)" mode="aspectFill" lazy-load />
                        <view v-else class="ch-thumb u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal sm">集</text></view>
                        <text class="ch-item-t">{{ itemTitle(item) }}</text>
                        <text class="ch-price">{{ itemPrice(item) }}</text>
                      </view>
                      <view v-if="card.filler" class="ch-row ch-fill" role="button" @click="openPublish">
                        <text class="ch-fill-t">{{ tx(card.filler) }}</text>
                      </view>
                    </template>
                  </view>
                  <scroll-view v-else-if="ready" class="ch-strip" scroll-x :show-scrollbar="false">
                    <view class="ch-strip-row">
                      <view v-for="item in card.items" :key="item.id" class="ch-tile" role="button"
                        :aria-label="`${itemTitle(item)} ${itemPrice(item)}`" @click="openItem(item.id)">
                        <image v-if="itemThumb(item)" class="ch-tile-img" :src="itemThumb(item)" mode="aspectFill" lazy-load />
                        <view v-else class="ch-tile-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal sm">集</text></view>
                        <text class="ch-tile-t">{{ itemTitle(item) }}</text>
                        <text class="ch-price">{{ itemPrice(item) }}</text>
                      </view>
                      <view v-if="card.filler" class="ch-tile ch-tile-go" role="button" @click="openPublish">
                        <text class="ch-tile-go-t">{{ tx(card.filler) }}</text>
                      </view>
                      <view class="ch-tile ch-tile-go" role="button" @click="openMarket">
                        <text class="ch-tile-go-t">{{ t('home.marketAll') }}</text>
                      </view>
                    </view>
                  </scroll-view>
                </view>
              </template>
            </view>

            <template v-if="ready">
              <view v-if="sections.latest.mode === 'list'" class="ch-latest" data-block="latest">
                <view class="ch-sec-h">
                  <text class="ch-sec-t" role="heading" aria-level="2">{{ t('home.latest') }}</text>
                  <text v-if="desktop" class="ch-link" role="button" @click="emit('all')">{{ t('home.allDiscussions') }}</text>
                </view>
                <view class="ch-list">
                  <view v-for="row in sections.latest.rows" :key="row.post.id" class="ch-lr" role="button"
                    :data-post-id="row.post.id" :aria-label="rowLabel(row)" @click="openPost(row.post.id)">
                    <view class="ch-lr-main">
                      <text class="ch-lr-t">{{ row.post.title }}</text>
                      <view class="ch-meta">
                        <UAvatar class="ch-av" :src="author(row)?.avatar_url" :owner="row.post.user_id" :fallback="defaultAvatarSrc" lazy />
                        <text v-if="row.post.category" class="ch-mi">{{ t(`plaza.category.${row.post.category}`) }}</text>
                        <text class="ch-mi">·</text>
                        <text class="ch-mi ch-author">{{ author(row)?.nickname || t('app.user') }}</text>
                        <text v-if="row.post.is_official" class="ch-tag ch-tag-line">{{ t('plaza.official') }}</text>
                        <text class="ch-mi">·</text>
                        <text class="ch-mi">{{ tx(row.time) }}</text>
                      </view>
                    </view>
                    <text v-if="row.replyCount" class="ch-pill">{{ row.replyCount }}</text>
                    <text v-else-if="row.unanswered" class="ch-tag ch-tag-ask">{{ t('plaza.unansweredTag') }}</text>
                  </view>
                </view>
                <view class="ch-more" role="button" @click="emit('all')">
                  <text class="ch-more-t">{{ t(desktop ? 'home.viewMore' : 'home.allDiscussionsBtn') }}</text>
                </view>
              </view>
              <!-- Fewer than five left after dedupe: the block is one link. -->
              <view v-else class="ch-latest ch-latest-link" data-block="latest">
                <view class="ch-more" role="button" @click="emit('all')">
                  <text class="ch-more-t">{{ desktop ? tx(sections.latest.link) : t('home.allDiscussionsBtn') }}</text>
                </view>
              </view>
            </template>
          </view>

          <view v-if="desktop" class="ch-side">
            <view v-if="ready && sections.newHere" class="ch-sb" data-block="start-here">
              <text class="ch-sb-h" role="heading" aria-level="2">{{ t('home.startHere') }}</text>
              <view v-for="row in sections.newHere" :key="row.post.id" class="ch-guide" role="button"
                :data-post-id="row.post.id" @click="openPost(row.post.id)">
                <text class="ch-guide-t">{{ row.post.title }}</text>
              </view>
            </view>
            <view v-if="ready && sections.hot" class="ch-sb" data-block="hot">
              <text class="ch-sb-h" role="heading" aria-level="2">{{ t('home.hotWeek') }}</text>
              <view v-for="row in sections.hot.rows" :key="row.post.id" class="ch-hot" role="button"
                :data-post-id="row.post.id" :aria-label="rowLabel(row)" @click="openPost(row.post.id)">
                <text class="ch-row-t">{{ row.post.title }}</text>
                <text v-if="row.replyCount" class="ch-cnt">{{ row.replyCount }}</text>
              </view>
            </view>
            <CommunityAbout v-if="sections.showAbout" data-block="about" />
          </view>
        </view>
      </template>
    </view>

    <view class="ch-foot">
      <view class="ch-foot-in">
        <a class="ch-foot-l" :href="lang === 'zh' ? '/about#zh' : '/about'">{{ t('home.about') }}</a>
        <text class="ch-foot-l" role="button" @click="openLegal('guidelines')">{{ t('legal.guidelines') }}</text>
        <text v-if="desktop" class="ch-foot-l" role="button" @click="openLegal('privacy')">{{ t('legal.privacy') }}</text>
        <text class="ch-foot-l" role="button" @click="sendFeedback">{{ t('home.feedback') }}</text>
        <text v-if="desktop" class="ch-foot-c">© {{ year }} {{ t('app.name') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import CommunityAbout from './CommunityAbout.vue'
import UAvatar from './UAvatar.vue'
import UIcon from './UIcon.vue'
import { useI18n } from '../composables/useI18n'
import { useTheme } from '../composables/useTheme'
import type { CommunityHomeItem, CommunityHomePost } from '../composables/useCommunityHome'
import { SUPPORT_EMAIL } from '../config/runtime'
import type { HomeItem, HomePostRow, HomeSections, HomeText } from '../utils/communityHome'
import type { PostCategory } from '../utils/communityPost'
import { listingPriceLabel, thumbUrl } from '../utils'

defineProps<{
  sections: HomeSections
  /** A snapshot has loaded; until then the cards hold skeleton rows. */
  ready: boolean
  failed: boolean
  desktop: boolean
  isLoggedIn: boolean
}>()
const emit = defineEmits<{
  (event: 'board', category: PostCategory): void
  (event: 'compose', category: PostCategory): void
  (event: 'all'): void
  (event: 'retry'): void
  (event: 'login'): void
}>()

const { t, lang, localize } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() => isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg')
const year = new Date().getFullYear()
const startOpen = ref(false)

// SPEC 5.2 ②: closing the notice is remembered on this device; a storage that
// cannot be read just shows it again.
const GUEST_NOTICE_KEY = 'community_guest_notice_closed'
function readGuestClosed() {
  try { return uni.getStorageSync(GUEST_NOTICE_KEY) === '1' } catch { return false }
}
const guestClosed = ref(readGuestClosed())
function closeGuest() {
  guestClosed.value = true
  try { uni.setStorageSync(GUEST_NOTICE_KEY, '1') } catch { /* storage unavailable: closed for this visit only */ }
}

// buildHomeSections words its copy in the two shipped languages.
const tx = (text: HomeText) => lang.value === 'zh' ? text.zh : text.en
const author = (row: HomePostRow) => (row.post as CommunityHomePost).profile
// A row is one button, so its name carries what the row shows.
function rowLabel(row: HomePostRow) {
  const parts = row.post.is_pinned ? [t('plaza.pinned'), row.post.title || ''] : [row.post.title || '']
  if (row.replyCount) parts.push(t('plaza.commentCount', { count: row.replyCount }))
  else if (row.unanswered) parts.push(t('plaza.unansweredTag'))
  parts.push(tx(row.time))
  return parts.join(' · ')
}

const itemTitle = (item: HomeItem) => localize((item as CommunityHomeItem).title_i18n, item.title)
const itemPrice = (item: HomeItem) => listingPriceLabel(item as CommunityHomeItem, t)
const itemThumb = (item: HomeItem) => thumbUrl(item.images?.[0], 'list')

function openPost(id: string) { uni.navigateTo({ url: `/pages/post/index?id=${id}` }) }
function openItem(id: string) { uni.navigateTo({ url: `/pages/detail/index?id=${id}` }) }
function openMarket() { uni.switchTab({ url: '/pages/index/index' }) }
function openPublish() { uni.switchTab({ url: '/pages/publish/index' }) }
function openLegal(type: 'guidelines' | 'terms' | 'privacy') { uni.navigateTo({ url: `/pages/legal/index?type=${type}` }) }
function sendFeedback() { window.location.href = `mailto:${SUPPORT_EMAIL}` }
</script>

<style lang="scss" scoped>
/*
 * Direction A (SPEC 9.2): white content on the canvas, hairlines instead of
 * shadows, the serif only on block titles. Colours, radii and spacing are
 * App.vue tokens. The fixed sizes are the ones SPEC 5.2 and 5.3 give: 34px card
 * rows, 48px item rows, 56px latest rows, a 300px sidebar, 128px tiles.
 */
.ch { color: var(--ink); }
.ch-wrap { min-width: 0; }

/* ---- shared pieces ---- */
.ch-bar { flex: none; width: 3px; height: var(--space-4); border-radius: var(--radius-xs); background: var(--line-bold); }
.ch-bname { flex: 0 1 auto; min-width: 0; font-size: var(--t-h3); line-height: var(--lh-h3); font-weight: 600; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-link { flex: none; margin-left: auto; font-size: var(--t-caption); line-height: var(--space-6); color: var(--ink-soft); white-space: nowrap; cursor: pointer; }
.ch-week + .ch-link { margin-left: 0; }
.ch-week { flex: none; margin-left: auto; margin-right: var(--space-1); font-size: var(--t-meta); color: var(--ink-quiet); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ch-card-h { display: flex; align-items: center; gap: var(--space-2); }
.ch-row { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ch-row-t { min-width: 0; color: var(--ink); overflow: hidden; }
.ch-mi { flex: none; font-size: var(--t-meta); line-height: var(--space-5); color: var(--ink-quiet); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ch-author { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ch-meta { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
.ch-cnt { flex: none; font-size: var(--t-meta); line-height: var(--space-5); color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.ch-tag {
  flex: none; padding: 0 var(--space-2); border-radius: var(--radius-xs);
  font-size: var(--t-meta); line-height: var(--space-5); font-weight: 500; white-space: nowrap;
  color: var(--ink-soft); background: var(--surface-alt);
}
.ch-tag-ask { color: var(--warning-text); background: var(--warning-soft); }
.ch-tag-line { color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-bold); }
.ch-fill-t {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
  font-size: var(--t-caption); line-height: var(--lh-h3); color: var(--ink-quiet);
}
.ch-sk { width: 76%; height: var(--space-3); }
.ch-sk-short { width: 54%; }
.ch-price { flex: none; font-size: var(--t-body); font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.ch-thumb { flex: none; width: 40px; height: 40px; border-radius: var(--radius-sm); overflow: hidden; background: var(--surface-alt); }
.ch-av { flex: none; width: var(--space-5); height: var(--space-5); border-radius: 50%; overflow: hidden; background: var(--surface-alt); }
.ch-pill {
  flex: none; min-width: var(--space-7); padding: 0 var(--space-2); border-radius: var(--radius-pill);
  font-size: var(--t-meta); line-height: var(--space-5); text-align: center;
  color: var(--ink-soft); background: var(--surface-alt); font-variant-numeric: tabular-nums;
}
.ch-btn-line {
  flex: none; padding: 0 var(--space-3); border-radius: var(--radius-sm);
  font-size: var(--t-caption); line-height: var(--space-7); color: var(--ink); white-space: nowrap;
  background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-bold); cursor: pointer;
}
.ch-sec-t { font-family: var(--font-serif); font-size: var(--t-h2); line-height: var(--lh-h2); font-weight: 500; color: var(--ink); }
.ch-sec-h { display: flex; align-items: center; gap: var(--space-6); }
.ch-lr { display: flex; align-items: center; gap: var(--space-3); min-height: 56px; border-top: 1px solid var(--line-hair); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ch-lr:first-child { border-top: 0; }
.ch-lr-main { flex: 1; min-width: 0; }
.ch-lr .ch-mi { font-size: var(--t-caption); }
.ch-lr-t { display: block; font-size: var(--t-body); line-height: var(--lh-caption); font-weight: 500; color: var(--ink); overflow: hidden; }
.ch-more { display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; }
.ch-more-t { color: var(--ink-soft); }
.ch-guide { display: flex; align-items: center; height: 36px; cursor: pointer; }
.ch-guide-t { min-width: 0; font-size: 14px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-foot-l { font-size: var(--t-meta); line-height: var(--space-5); color: var(--ink-soft); text-decoration: none; cursor: pointer; }
.ch-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); padding: var(--space-8) var(--space-4); }
.ch-state-t { font-size: 14px; color: var(--ink-soft); text-align: center; }
.ch-guest { display: flex; align-items: center; height: 44px; background: var(--surface); }
.ch-guest-t { flex: 1; min-width: 0; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-guest-x { flex: none; display: flex; align-items: center; justify-content: center; cursor: pointer; }

/* ---- phone (also 768–1023, where the content column is capped at 720px) ---- */
/* Room for the tab bar and the floating button above it, so the last line is never under either. */
.ch-m { padding-bottom: calc(62px + 52px + var(--space-4) + env(safe-area-inset-bottom, 0px)); }
.ch-m .ch-wrap { max-width: 720px; margin: 0 auto; }
.ch-m .ch-guest { gap: var(--space-2); padding: 0 var(--space-1) 0 var(--space-4); }
.ch-m .ch-guest-t {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal;
  font-size: var(--t-caption); line-height: var(--lh-h3);
}
.ch-m .ch-guest-x { width: 36px; height: 36px; }
.ch-m .ch-sec, .ch-m .ch-card, .ch-m .ch-latest { margin-top: var(--space-2); background: var(--surface); }
.ch-m .ch-fold { display: flex; align-items: center; height: 48px; padding: 0 var(--space-4); cursor: pointer; }
.ch-fold-t { font-size: 14px; color: var(--ink); }
.ch-m .ch-guide { padding: 0 var(--space-4); border-top: 1px solid var(--line-hair); }
.ch-m .ch-card-h { height: 44px; padding: 0 var(--space-4); }
.ch-m .ch-row { padding: var(--space-2) var(--space-4); min-height: 52px; border-top: 1px solid var(--line-hair); }
.ch-m .ch-row-t, .ch-m .ch-lr-t {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere;
  font-size: var(--t-body); line-height: 1.4;
}
.ch-m .ch-meta { margin-top: var(--space-1); }
.ch-m .ch-row-sk, .ch-m .ch-fill { display: flex; align-items: center; }
.ch-m .ch-strip { width: 100%; white-space: nowrap; }
.ch-m .ch-strip-row { display: flex; gap: var(--space-3); width: max-content; padding: 0 var(--space-4) var(--space-4); }
.ch-tile { flex: none; width: 128px; display: flex; flex-direction: column; cursor: pointer; }
.ch-tile-img { width: 128px; height: 128px; border-radius: var(--radius-sm); overflow: hidden; background: var(--surface-alt); }
.ch-tile-t { margin-top: var(--space-2); font-size: var(--t-caption); line-height: var(--lh-caption); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-tile-go { height: 128px; align-items: center; justify-content: center; border-radius: var(--radius-sm); box-shadow: inset 0 0 0 1px var(--line-soft); }
.ch-tile-go-t { padding: 0 var(--space-2); font-size: var(--t-caption); color: var(--ink-soft); white-space: normal; text-align: center; }
.ch-m .ch-latest { padding-bottom: var(--space-4); }
.ch-m .ch-sec-h { min-height: 52px; padding: 0 var(--space-4); }
.ch-m .ch-lr { padding: var(--space-3) var(--space-4); }
.ch-m .ch-more { height: 44px; margin: var(--space-2) var(--space-4) 0; box-shadow: inset 0 0 0 1px var(--line-bold); }
.ch-m .ch-more-t { font-size: var(--t-body); color: var(--ink); }
.ch-m .ch-latest-link { padding-top: var(--space-2); }
.ch-m .ch-foot-in { display: flex; justify-content: center; gap: var(--space-4); padding: var(--space-5) var(--space-4) var(--space-6); }

/* #ifdef H5 */
/* ---- desktop, from 1024px (SPEC 5.2): a 1200px container, 876 + 24 + 300 ---- */
.ch-d .ch-wrap { width: min(1200px, calc(100% - var(--space-8))); margin: 0 auto; }
.ch-d .ch-guest {
  gap: var(--space-3); margin-top: var(--space-4); padding: 0 var(--space-2) 0 var(--space-4);
  border: 1px solid var(--line-soft); border-radius: var(--radius-sm);
}
.ch-d .ch-guest-t { font-size: 14px; }
.ch-d .ch-guest-x { width: var(--space-7); height: var(--space-7); }
.ch-d .ch-cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px; column-gap: var(--space-6); align-items: start; margin-top: var(--space-5); }
.ch-d .ch-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: var(--space-6); row-gap: var(--space-4); }
.ch-d .ch-card, .ch-d .ch-sb {
  background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-sm);
  padding: var(--space-4) var(--space-5);
}
.ch-d .ch-card-h { height: var(--space-6); }
.ch-d .ch-desc {
  display: block; padding-left: calc(3px + var(--space-2)); font-size: var(--t-caption); line-height: var(--space-5);
  color: var(--ink-quiet); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Four 34px rows whether or not the board has four topics, so cards keep their height. */
.ch-d .ch-rows { min-height: 136px; margin-top: var(--space-2); padding-top: var(--space-1); border-top: 1px solid var(--line-hair); }
.ch-d .ch-row { display: flex; align-items: center; gap: var(--space-2); height: 34px; }
.ch-d .ch-row-t { flex: 0 1 auto; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.ch-d .ch-row-m { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); min-width: 76px; margin-left: auto; }
.ch-item { display: flex; align-items: center; gap: var(--space-3); height: 48px; cursor: pointer; }
.ch-item-t { flex: 1; min-width: 0; font-size: 14px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-d .ch-latest { margin-top: var(--space-7); }
.ch-d .ch-sec-h { margin-bottom: var(--space-3); }
.ch-d .ch-list { background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); }
.ch-d .ch-lr { padding: var(--space-2) var(--space-5); }
.ch-d .ch-lr-t { text-overflow: ellipsis; white-space: nowrap; }
.ch-d .ch-more { height: 40px; margin-top: var(--space-3); box-shadow: inset 0 0 0 1px var(--line-soft); }
.ch-d .ch-more-t { font-size: 14px; }
.ch-d .ch-latest-link .ch-more { margin-top: 0; }
.ch-d .ch-side { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.ch-sb-h { display: block; margin-bottom: var(--space-1); font-size: var(--t-body); line-height: var(--space-7); font-weight: 600; color: var(--ink); }
.ch-hot { display: flex; align-items: center; gap: var(--space-3); height: 34px; cursor: pointer; }
.ch-hot .ch-row-t { flex: 1; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.ch-d .ch-foot { margin-top: var(--space-8); border-top: 1px solid var(--line-soft); }
.ch-d .ch-foot-in {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4);
  width: min(1200px, calc(100% - var(--space-8))); margin: 0 auto; padding: var(--space-5) 0 var(--space-6);
}
.ch-foot-c { font-size: var(--t-meta); line-height: var(--space-5); color: var(--ink-quiet); }
.ch-row:focus-visible, .ch-lr:focus-visible, .ch-item:focus-visible, .ch-hot:focus-visible, .ch-guide:focus-visible { outline-offset: -2px; }
.ch-foot-l:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
/* #endif */
</style>
