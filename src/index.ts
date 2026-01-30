import $ from 'jquery';
import { bitable, FieldType, IGetRecordsByPageResponse, IOpenAttachment } from '@lark-base-open/js-sdk';
import dayjs from 'dayjs';
import _ from 'lodash';
import './index.scss';

// Field Names Configuration
const FIELD_NAMES = {
  MSG_SEQ: '消息序号',
  MSG_ID: '消息id',
  SENDER_ID: '消息发送方id',
  MSG_TYPE: '消息类型',
  GROUP_ID: '群聊消息的群id',
  GROUP_NAME: '群聊消息的群名称',
  SEND_TIME: '消息发送时间',
  CONTENT_TEXT: '消息内容_文本',
  CONTENT_MEDIA: '消息内容_媒体文件',
  CREATE_TIME: '创建时间',
  RECEIVER: '接收人',
  SENDER_NAME: '消息发送人名称',
  SENDER_AVATAR: '消息发送人头像链接',
  RECEIVER_NAME: '接收人名称',
  RECEIVER_AVATAR: '接收人头像链接',
};

interface ChatMessage {
  recordId: string; // Bitable Record ID
  id: string;
  seq: number;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  msgType: string;
  content: string;
  media?: IOpenAttachment[];
  mediaUrls?: string[]; // To store fetched URLs
  time: number; // timestamp
  isSelf: boolean; // determined at runtime
}

interface ChatSession {
  id: string; // unique key
  name: string;
  avatar: string; // Chat avatar (group or user)
  type: 'single' | 'group';
  messages: ChatMessage[];
  participants: Set<string>;
  lastTime: number;
}

let allChats: ChatSession[] = [];
let currentChatId: string | null = null;
let currentUserId: string = ''; // We will try to guess or let user pick
let globalFieldMap: Record<string, string> = {}; // Store field IDs globally
let aiConfig: { proxyUrl?: string; model?: string; apiKey?: string } = {};

$(async function () {
  try {
    // Increase timeout to 30s to allow real data loading
    const timeout = new Promise((_, reject) => setTimeout(() => reject('Timeout'), 30000));
    await Promise.race([init(), timeout]);
  } catch (e) {
    console.warn('Failed to load bitable data (likely running locally), using mock data.', e);
    loadMockData();
  }
  bindAI();
});

function loadMockData() {
  currentUserId = '章文洁';

  // Mock Single Chat
  const chat1Id = 'single_AL_章文洁';
  const chat1: ChatSession = {
    id: chat1Id,
    name: 'AL',
    avatar: '',
    type: 'single',
    messages: [
      { recordId: 'mock1', id: '1', seq: 1, senderId: 'AL', senderName: 'AL', senderAvatar: '', msgType: 'text', content: '你好', time: Date.now() - 3600000, isSelf: false },
      { recordId: 'mock2', id: '2', seq: 2, senderId: '章文洁', senderName: '章文洁', senderAvatar: '', msgType: 'text', content: '你好呀，可以给我你的微信上发一份你的最新简历；卫瓴科技是红杉、腾讯等资本投资的A轮科技企业...', time: Date.now() - 3500000, isSelf: true },
      { recordId: 'mock3', id: '3', seq: 3, senderId: 'AL', senderName: 'AL', senderAvatar: '', msgType: 'text', content: '好的 稍等', time: Date.now() - 3400000, isSelf: false },
      { recordId: 'mock4', id: '4', seq: 4, senderId: 'AL', senderName: 'AL', senderAvatar: '', msgType: 'file', content: '', media: [{ name: '冷先生-销售.pdf', type: 'application/pdf', size: 296000, token: 'xxx', timeStamp: 0, permission: {} } as any], time: Date.now() - 3400000, isSelf: false }
    ],
    participants: new Set(['AL', '章文洁']),
    lastTime: Date.now()
  };

  // Mock Group Chat
  const chat2Id = 'group_101';
  const chat2: ChatSession = {
    id: chat2Id,
    name: '产品讨论群',
    avatar: '',
    type: 'group',
    messages: [
      { recordId: 'mock11', id: '11', seq: 1, senderId: 'Bob', senderName: 'Bob', senderAvatar: '', msgType: 'text', content: '大家看下这个需求', time: Date.now() - 7200000, isSelf: false },
      { recordId: 'mock12', id: '12', seq: 2, senderId: '章文洁', senderName: '章文洁', senderAvatar: '', msgType: 'text', content: '收到', time: Date.now() - 7100000, isSelf: true }
    ],
    participants: new Set(['Bob', '章文洁']),
    lastTime: Date.now() - 100000
  };

  allChats = [chat1, chat2];
  renderChatList();
  if (allChats.length > 0) selectChat(allChats[0].id);
}

async function init() {
  console.log('Initializing plugin...');
  const table = await bitable.base.getActiveTable();
  console.log('Connected to table:', await table.getName());

  const fieldMetaList = await table.getFieldMetaList();
  console.log('Available fields in table:', fieldMetaList.map(f => f.name));

  // Map field names to IDs
  const fieldMap: Record<string, string> = {};
  let foundAnyField = false;
  const missingFields: string[] = [];

  for (const key in FIELD_NAMES) {
    const name = FIELD_NAMES[key as keyof typeof FIELD_NAMES];
    const field = fieldMetaList.find(f => f.name === name);
    if (field) {
      fieldMap[key] = field.id;
      foundAnyField = true;
    } else {
      missingFields.push(name);
    }
  }

  if (!foundAnyField) {
    // Silent failure for local dev to avoid console spam
    throw new Error('No matching fields found, switching to Mock Data.');
  }

  if (missingFields.length > 0) {
    console.warn('Some fields were not found:', missingFields.join(', '));
  }

  globalFieldMap = fieldMap;

  let allRecords: any[] = [];
  let pageToken: number | undefined = undefined;
  let hasMore = true;
  let total = 0;

  const MAX_RECORDS = 1000000;

  const activeView = await table.getActiveView();
  const activeViewName = await activeView.getName();
  const activeViewId = activeView.id;

  console.log('Start loading records...');
  console.log(`Active view: ${activeViewName}`);
  while (hasMore && allRecords.length < MAX_RECORDS) {
    const res: IGetRecordsByPageResponse = await table.getRecordsByPage({
      pageSize: 200,
      pageToken: pageToken,
      viewId: activeViewId
    });
    allRecords.push(...res.records);
    pageToken = res.pageToken;
    hasMore = res.hasMore;
    total = res.total;
    console.log(`Loaded ${allRecords.length} records...`);
  }

  console.log(`Finished loading. Total records: ${allRecords.length}, view: ${activeViewName}`);

  const rawRecords = allRecords;

  // Process Data
  const chats: Record<string, ChatSession> = {};

  for (const record of rawRecords) {
    const fields = record.fields;

    const senderId = (fields[fieldMap.SENDER_ID] as any)?.[0]?.text || (fields[fieldMap.SENDER_ID] as string) || 'Unknown';
    const senderName = (fields[fieldMap.SENDER_NAME] as any)?.[0]?.text || (fields[fieldMap.SENDER_NAME] as string) || senderId;
    const senderAvatar = (fields[fieldMap.SENDER_AVATAR] as any)?.[0]?.text || (fields[fieldMap.SENDER_AVATAR] as string) || '';

    // Receiver might be a text field or user field? Assuming text based on prompt
    const receiver = (fields[fieldMap.RECEIVER] as any)?.[0]?.text || (fields[fieldMap.RECEIVER] as string) || 'Unknown';
    const receiverName = (fields[fieldMap.RECEIVER_NAME] as any)?.[0]?.text || (fields[fieldMap.RECEIVER_NAME] as string) || receiver;
    const receiverAvatar = (fields[fieldMap.RECEIVER_AVATAR] as any)?.[0]?.text || (fields[fieldMap.RECEIVER_AVATAR] as string) || '';

    const groupId = (fields[fieldMap.GROUP_ID] as any)?.[0]?.text || (fields[fieldMap.GROUP_ID] as string);
    const groupName = (fields[fieldMap.GROUP_NAME] as any)?.[0]?.text || (fields[fieldMap.GROUP_NAME] as string);

    const msgType = (fields[fieldMap.MSG_TYPE] as any)?.text || (fields[fieldMap.MSG_TYPE] as string); // Select field returns object?

    const contentText = (fields[fieldMap.CONTENT_TEXT] as any)?.[0]?.text || (fields[fieldMap.CONTENT_TEXT] as string) || '';
    const contentMedia = fields[fieldMap.CONTENT_MEDIA] as IOpenAttachment[];

    const timeVal = fields[fieldMap.SEND_TIME] || fields[fieldMap.CREATE_TIME];
    let time = 0;

    // Improved time parsing
    let rawTime = timeVal;

    // Unpack if it's an array (Text field or similar often returns [{ text: '...' }])
    if (Array.isArray(timeVal) && timeVal.length > 0) {
      if (timeVal[0]?.text) {
        rawTime = timeVal[0].text;
      } else {
        rawTime = timeVal[0];
      }
    }

    if (typeof rawTime === 'number') {
      time = rawTime;
    } else if (typeof rawTime === 'string') {
      // Try parsing string date
      // Remove potential noise if necessary, but standard YYYY-MM-DD HH:mm:ss works with dayjs
      const d = dayjs(rawTime);
      if (d.isValid()) {
        time = d.valueOf();
      }
    }

    // If time is still 0 or invalid, fallback to current time or 0
    if (!time || isNaN(time)) {
      time = 0;
    }

    const msgId = (fields[fieldMap.MSG_ID] as any)?.[0]?.text || (fields[fieldMap.MSG_ID] as string);
    const seq = (fields[fieldMap.MSG_SEQ] as number) || 0;

    let chatId = '';
    let chatName = '';
    let chatAvatar = '';
    let type: 'single' | 'group' = 'single';

    if (groupId) {
      chatId = `group_${groupId}`;
      chatName = groupName || `Group ${groupId}`;
      type = 'group';
      // Group avatar could be fixed or first letter
    } else {
      // Single chat: Sort sender and receiver
      const participants = [senderId, receiver].sort();
      chatId = `single_${participants.join('_')}`;
      // Naming is tricky. 
      chatName = `${participants[0]} & ${participants[1]}`;
      type = 'single';
    }

    if (!chats[chatId]) {
      chats[chatId] = {
        id: chatId,
        name: chatName,
        avatar: chatAvatar,
        type: type,
        messages: [],
        participants: new Set(),
        lastTime: 0
      };
    }

    chats[chatId].participants.add(senderId);
    if (receiver) chats[chatId].participants.add(receiver);

    // Update Chat Name/Avatar for Single Chat logic later (after we identify "Me")
    // Store metadata in the message or session to help resolve later
    // For now, we store raw data in message

    chats[chatId].messages.push({
      recordId: record.recordId,
      id: msgId,
      seq: seq,
      senderId: senderId,
      senderName: senderName,
      senderAvatar: senderAvatar,
      msgType: JSON.stringify(msgType), // handle object or string
      content: contentText,
      media: contentMedia,
      time: time,
      isSelf: false // Set later
    });

    if (time > chats[chatId].lastTime) {
      chats[chatId].lastTime = time;
    }
  }

  // Convert to array and sort by last active
  allChats = Object.values(chats).sort((a, b) => b.lastTime - a.lastTime);

  // Attempt to guess "Me"
  // Heuristic: The user who appears in the MOST chats as a participant might be "Me"?
  // Or: In single chats, if A talks to B, C, D... A is likely "Me".
  const participantCounts: Record<string, number> = {};
  const userProfiles: Record<string, { name: string; avatar: string }> = {};

  for (const chat of allChats) {
    // Build user profiles from messages
    chat.messages.forEach(msg => {
      if (msg.senderId && !userProfiles[msg.senderId]) {
        userProfiles[msg.senderId] = { name: msg.senderName, avatar: msg.senderAvatar };
      }
    });

    if (chat.type === 'single') {
      chat.participants.forEach(p => {
        participantCounts[p] = (participantCounts[p] || 0) + 1;
      });
    }
  }
  // Find max
  let likelyMe = '';
  let maxCount = -1;
  for (const p in participantCounts) {
    if (participantCounts[p] > maxCount) {
      maxCount = participantCounts[p];
      likelyMe = p;
    }
  }
  currentUserId = likelyMe;

  // Update Current User Info in Sidebar
  const meProfile = userProfiles[currentUserId];
  const meName = meProfile ? meProfile.name : currentUserId;
  const meAvatar = meProfile ? meProfile.avatar : '';

  $('#currentUserInfo .username').text(meName);
  if (meAvatar) {
    $('#currentUserInfo .avatar').html(`<img src="${meAvatar}" alt="${meName}" />`);
  } else {
    $('#currentUserInfo .avatar').text(meName ? meName[0].toUpperCase() : 'Me');
  }

  // Theme initialization
  const theme = await bitable.bridge.getTheme();
  document.body.setAttribute('data-theme', theme);

  bitable.bridge.onThemeChange((event) => {
    document.body.setAttribute('data-theme', event.data.theme);
  });

  // Update "isSelf" and Chat Info
  allChats.forEach(chat => {
    chat.messages.forEach(msg => {
      msg.isSelf = msg.senderId === currentUserId;
    });
    // Update name for single chat to be the "Other" person
    if (chat.type === 'single') {
      const otherId = Array.from(chat.participants).find(p => p !== currentUserId);
      if (otherId) {
        const profile = userProfiles[otherId];
        chat.name = profile ? profile.name : otherId;
        chat.avatar = profile ? profile.avatar : '';
      }
    } else {
      // Group chat: try to find a default avatar if none?
      // For now, keep as is.
    }
  });

  // Sort messages
  allChats.forEach(chat => {
    chat.messages.sort((a, b) => a.time - b.time);
  });

  renderChatList();

  // Select first chat
  if (allChats.length > 0) {
    selectChat(allChats[0].id);
  } else {
    $('#chatList .loading').text('No chats found.');
  }

  // Bind events
  $(document).on('click', '.chat-item', function () {
    const id = $(this).data('id');
    selectChat(id);
  });

  // Bind refresh button
  $('#refreshBtn').on('click', async function () {
    $(this).prop('disabled', true).text('刷新中...');
    try {
      // Reset state
      allChats = [];
      currentChatId = null;
      $('#chatList').html('<div class="loading">正在重新加载数据...</div>');
      $('#messageList').empty();
      // Re-initialize
      await init();
    } catch (e) {
      console.error('Refresh failed:', e);
      $('#chatList .loading').text('刷新失败，请重试');
    }
    $(this).prop('disabled', false).text('🔄 刷新');
  });
}

function normalizeTime(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t === 'string') {
    const d = dayjs(t);
    return d.isValid() ? d.valueOf() : 0;
  }
  try {
    const d = dayjs(t);
    return d.isValid() ? d.valueOf() : 0;
  } catch {
    return 0;
  }
}

function renderChatList() {
  const $list = $('#chatList');
  $list.empty();

  allChats.forEach(chat => {
    const lastMsg = chat.messages[chat.messages.length - 1];
    const preview = lastMsg ? (lastMsg.content || '[Media]') : '';
    const timeStr = (lastMsg && lastMsg.time > 0) ? dayjs(lastMsg.time).format('HH:mm') : '';

    const avatarContent = chat.avatar
      ? `<img src="${chat.avatar}" alt="${chat.name}" />`
      : (chat.name ? chat.name[0].toUpperCase() : '?');

    const $item = $(`
      <div class="chat-item" data-id="${chat.id}">
        <div class="avatar">${avatarContent}</div>
        <div class="chat-info">
          <div class="chat-top">
            <div class="chat-name">${chat.name}</div>
            <div class="chat-time">${timeStr}</div>
          </div>
          <div class="chat-preview">${preview}</div>
        </div>
      </div>
    `);
    $list.append($item);
  });
}

async function selectChat(id: string) {
  currentChatId = id;
  const chat = allChats.find(c => c.id === id);
  if (!chat) return;

  // Update active state
  $('.chat-item').removeClass('active');
  $(`.chat-item[data-id="${id}"]`).addClass('active');

  // Update Header
  $('#chatHeader .chat-title').text(chat.name);

  // Render Messages
  const $msgs = $('#messageList');
  $msgs.empty();

  // Show loading for messages if there are media items without URLs
  // This is a simple optimization: if we already fetched URLs, we don't fetch again
  // For now, we fetch every time or rely on browser cache if the URL is stable (it's not always)
  // Let's check if we need to fetch URLs
  const mediaFieldId = globalFieldMap.CONTENT_MEDIA;
  if (mediaFieldId) {
    // Collect messages that need URL fetching
    const table = await bitable.base.getActiveTable();
    const mediaField = await table.getField<any>(mediaFieldId);

    // We can do this in parallel
    const urlPromises = chat.messages.map(async msg => {
      if (msg.media && msg.media.length > 0 && !msg.mediaUrls) {
        try {
          // Fetch URLs for this record
          // Note: getAttachmentUrls returns string[] corresponding to attachments
          const urls = await mediaField.getAttachmentUrls(msg.recordId);
          msg.mediaUrls = urls;
        } catch (e) {
          console.error('Failed to fetch attachment URLs', e);
        }
      }
    });

    await Promise.all(urlPromises);
  }

  let lastTime = 0;

  chat.messages.forEach(msg => {
    // Time separator (e.g., > 5 mins difference)
    if (msg.time - lastTime > 5 * 60 * 1000) {
      $msgs.append(`<div class="system-message">${dayjs(msg.time).format('MM-DD HH:mm')}</div>`);
      lastTime = msg.time;
    }

    const side = msg.isSelf ? 'message-right' : 'message-left';

    const avatarContent = msg.senderAvatar
      ? `<img src="${msg.senderAvatar}" alt="${msg.senderName}" />`
      : (msg.senderName ? msg.senderName[0].toUpperCase() : '?');

    let contentHtml = '';
    if (msg.content) {
      contentHtml += `<div>${escapeHtml(msg.content)}</div>`;
    }
    if (msg.media && msg.media.length > 0) {
      msg.media.forEach((m, index) => {
        const url = msg.mediaUrls ? msg.mediaUrls[index] : '';
        // Check if image
        if (m.type.startsWith('image/') && url) {
          contentHtml += `<div><img src="${url}" alt="${m.name}" style="max-width: 200px; max-height: 200px;" /></div>`;
        } else if (url) {
          contentHtml += `<div><a href="${url}" target="_blank">[File: ${m.name}]</a></div>`;
        } else {
          contentHtml += `<div>[File: ${m.name}]</div>`;
        }
      });
    }

    const $msg = $(`
      <div class="message ${side}">
        <div class="avatar" title="${msg.senderName}">${avatarContent}</div>
        <div class="content">
          <div class="sender-name" style="${msg.isSelf ? 'text-align: right' : 'text-align: left'}">
            ${msg.senderName} <span style="color: #999; font-size: 10px; margin-left: 4px;">${dayjs(msg.time).format('HH:mm')}</span>
          </div>
          <div class="bubble">${contentHtml}</div>
        </div>
      </div>
    `);
    $msgs.append($msg);
  });

  // Scroll to bottom
  $msgs.scrollTop($msgs[0].scrollHeight);
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function bindAI() {
  // Load config from localStorage or fallback to URL/Global
  const savedConfig = JSON.parse(localStorage.getItem('wechat_plugin_ai_config') || '{}');
  const urlParams = new URLSearchParams(location.search);

  // Default to DeepSeek
  aiConfig.proxyUrl = savedConfig.proxyUrl || urlParams.get('aiProxyUrl') || (window as any).AI_PROXY_URL || 'https://api.deepseek.com/chat/completions';
  aiConfig.model = savedConfig.model || urlParams.get('aiModel') || 'deepseek-chat';
  aiConfig.apiKey = savedConfig.apiKey || urlParams.get('aiApiKey') || (window as any).AI_API_KEY || 'sk-62786a5750354bc8ab70b7437df064e6';

  // UI Event Bindings
  $('#aiSettingsBtn').on('click', () => {
    const $settings = $('#aiSettings');
    if ($settings.is(':visible')) {
      $settings.hide();
    } else {
      // Fill current values
      $('#aiProxyUrl').val(aiConfig.proxyUrl || 'https://api.deepseek.com/chat/completions');
      $('#aiApiKey').val(aiConfig.apiKey || '');
      $('#aiModel').val(aiConfig.model || 'deepseek-chat');
      $settings.show();
    }
  });

  $('#aiSaveSettingsBtn').on('click', () => {
    const newConfig = {
      proxyUrl: String($('#aiProxyUrl').val() || '').trim(),
      apiKey: String($('#aiApiKey').val() || '').trim(),
      model: String($('#aiModel').val() || '').trim(),
    };

    // Save to localStorage
    localStorage.setItem('wechat_plugin_ai_config', JSON.stringify(newConfig));

    // Update runtime config
    aiConfig = newConfig;

    $('#aiSettings').hide();
    $('#aiStatus').text('配置已保存');
  });

  $('#aiAnalyzeBtn').on('click', async () => {
    const q = String($('#aiInput').val() || '').trim();
    if (!q) {
      $('#aiStatus').text('请输入分析需求');
      return;
    }
    if (!aiConfig.proxyUrl) {
      $('#aiStatus').text('未配置API URL，请点击右上角配置');
      return;
    }
    $('#aiStatus').text('分析中...');

    const days = parseInt(String($('#aiTimeRange').val()), 10);
    const summary = buildMessageDetails(days);

    // Check if too large (approximate check)
    if (summary.length > 300000) {
      $('#aiStatus').text('警告: 数据量过大，可能会超出模型限制，正在尝试发送...');
    }

    const prompt = `用户需求：${q}\n\n聊天记录数据（请根据以下明细数据进行分析）：\n${summary}`;

    try {
      const res = await fetch(aiConfig.proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(aiConfig.apiKey ? { 'Authorization': `Bearer ${aiConfig.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: aiConfig.model,
          messages: [
            { role: 'system', content: '你是一个商业分析助手。用户会提供一份聊天记录明细，请根据这些记录回答用户的需求。请忽略格式上的噪音，专注于内容分析。' },
            { role: 'user', content: prompt }
          ]
        })
      });
      const data = await res.json();
      const content =
        data?.choices?.[0]?.message?.content ||
        data?.data?.choices?.[0]?.message?.content ||
        JSON.stringify(data, null, 2);
      $('#aiResult').text(content);
      $('#aiStatus').text('分析完成');
    } catch (e) {
      $('#aiStatus').text('分析失败');
      $('#aiResult').text(String(e));
    }
  });
}

function buildDataSummary(): string {
  const totalChats = allChats.length;
  const groupCount = allChats.filter(c => c.type === 'group').length;
  const singleCount = totalChats - groupCount;

  // Stats
  let totalMessages = 0;
  let minTime = Infinity;
  let maxTime = -Infinity;
  const participantStats: Record<string, number> = {};

  allChats.forEach(c => {
    totalMessages += c.messages.length;
    c.messages.forEach(m => {
      if (m.time < minTime) minTime = m.time;
      if (m.time > maxTime) maxTime = m.time;
      const sender = m.senderId || 'Unknown';
      participantStats[sender] = (participantStats[sender] || 0) + 1;
    });
  });

  const timeRange = totalMessages > 0
    ? `${dayjs(minTime).format('YYYY-MM-DD')} 至 ${dayjs(maxTime).format('YYYY-MM-DD')}`
    : '无数据';

  const topSenders = Object.entries(participantStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `${name}(${count})`)
    .join(', ');

  const topChats = [...allChats].sort((a, b) => b.messages.length - a.messages.length).slice(0, 5)
    .map(c => `${c.name}(${c.type}) 消息数:${c.messages.length}`);

  const latestMsgs = [...allChats].flatMap(c => c.messages.slice(-1)).sort((a, b) => b.time - a.time).slice(0, 8)
    .map(m => `[${dayjs(m.time).format('MM-DD HH:mm')}] ${m.senderId}: ${m.content?.slice(0, 50) || '(Media)'}`);

  return [
    `【基本概况】`,
    `会话总数：${totalChats} (单聊${singleCount}, 群聊${groupCount})`,
    `消息总数：${totalMessages}`,
    `时间跨度：${timeRange}`,
    `【活跃发言人Top10】`,
    `${topSenders}`,
    `【最活跃会话Top5】`,
    `${topChats.join('; ')}`,
    `【最新消息示例】`,
    `${latestMsgs.join('\n')}`
  ].join('\n');
}

function buildMessageDetails(days: number): string {
  // days=0 means all
  const now = Date.now();
  const cutoff = days > 0 ? now - days * 24 * 60 * 60 * 1000 : 0;

  let msgs: { time: number; sender: string; content: string; chatName: string; type: string }[] = [];

  allChats.forEach(chat => {
    chat.messages.forEach(m => {
      if (m.time >= cutoff) {
        msgs.push({
          time: m.time,
          sender: m.senderId || 'Unknown',
          content: m.content || (m.media?.length ? '[Media]' : ''),
          chatName: chat.name,
          type: chat.type
        });
      }
    });
  });

  // Sort by time asc
  msgs.sort((a, b) => a.time - b.time);

  if (msgs.length === 0) {
    return "无符合时间范围的消息记录。";
  }

  // Format
  return msgs.map(m => {
    const timeStr = dayjs(m.time).format('YYYY-MM-DD HH:mm:ss');
    return `[${timeStr}] [${m.type === 'group' ? '群:' + m.chatName : '私聊:' + m.chatName}] ${m.sender}: ${m.content}`;
  }).join('\n');
}
