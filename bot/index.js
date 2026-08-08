const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionFlagsBits, Events, ChannelType, StringSelectMenuBuilder
} = require('discord.js');
const http = require('http');

if (!process.env.TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.error('❌ Variables manquantes sur Render !');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    allowedMentions: { parse: ['users'], repliedUser: false }
});

const CONFIG = {
    staffRoleId: '1531835193395122186',
    logsChannelId: '1531829572914511955',
    ticketCategoryId: '1531833907438289018',
    candidatureChannelId: '1533106862386446468',
    reglementsChannelId: '1531831739431911486',
    generalChannelId: '1531833131823267901',
    aiChannelId: '1533573265014919198', // 🚨 SEUL SALON OÙ L'IA AGIT
    unverifiedRoleId: '1532905582175191120',
    memberRoleId: '1531832874599448666',
    logoUrl: 'https://cdn.discordapp.com/icons/1531829572453007533/c69bf91096081b8274e81a0a0eefa18e.webp?size=1024',
    primaryBlue: '#42749e',
    primaryRed: '#b74752',
    gold: '#c9a961'
};

// ============================================================
// MÉMOIRE DE CONVERSATION (Par utilisateur, pour le soutien)
// ============================================================
const conversationHistory = new Map();

function addToHistory(userId, role, message) {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);
    history.push({ role: role, content: message, timestamp: Date.now() });
    if (history.length > 30) history.shift(); // Garde les 30 derniers échanges
}

function getHistoryArray(userId) {
    return conversationHistory.get(userId) || [];
}

// Nettoyage des vieilles conversations (toutes les heures)
setInterval(() => {
    const now = Date.now();
    conversationHistory.forEach((history, userId) => {
        const filtered = history.filter(h => now - h.timestamp < 2 * 60 * 60 * 1000);
        if (filtered.length === 0) conversationHistory.delete(userId);
        else conversationHistory.set(userId, filtered);
    });
}, 60 * 60 * 1000);

// ============================================================
// ANTI-DOUBLON LOGS
// ============================================================
const recentEvents = new Set();
function shouldLog(eventId) {
    if (!eventId) return true;
    if (recentEvents.has(eventId)) return false;
    recentEvents.add(eventId);
    setTimeout(() => recentEvents.delete(eventId), 3000);
    return true;
}

// ============================================================
// BASE DE DONNÉES DISCORD
// ============================================================
async function getDbChannel(guild) {
    let ch = guild.channels.cache.find(c => c.name === 'bot-database');
    if (ch) return ch;
    try {
        ch = await guild.channels.create({
            name: 'bot-database',
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: guild.id, deny: ['ViewChannel'] },
                { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages'] }
            ]
        });
        const adminRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.Administrator));
        if (adminRole) await ch.permissionOverwrites.edit(adminRole, { ViewChannel: true });
        return ch;
    } catch (e) { return null; }
}

async function sendLog(guild, title, fields, color = CONFIG.gold, eventId = null) {
    if (!shouldLog(eventId)) return;
    const embed = new EmbedBuilder().setColor(color).setTitle(`📝 ${title}`).addFields(fields)
        .setFooter({ text: 'Zone Gaming QC • Logs', iconURL: CONFIG.logoUrl }).setTimestamp();
    
    const logCh = guild.channels.cache.get(CONFIG.logsChannelId);
    if (logCh) await logCh.send({ embeds: [embed] }).catch(() => {});
    
    const dbCh = await getDbChannel(guild);
    if (dbCh) {
        const logEntry = `**[${new Date().toLocaleTimeString('fr-FR')}]** ${title}\n${fields.map(f => `• **${f.name}:** ${f.value}`).join('\n')}\n─────────────────`;
        await dbCh.send({ content: logEntry.substring(0, 2000) }).catch(() => {});
    }
}

// ============================================================
// SERVEUR HTTP (OAuth2 & Candidatures)
// ============================================================
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }

    if (req.url === '/api/auth/discord' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                const { code } = JSON.parse(body);
                const tr = await fetch('https://discord.com/api/oauth2/token', {
                    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: 'https://jacobin904.github.io/Zone-Gaming-QC/Postuler/callback.html' })
                });
                const td = await tr.json();
                if (!tr.ok) throw new Error(td.error_description || 'Erreur OAuth2');
                const ur = await fetch('https://discord.com/api/users/@me', { headers: { 'Authorization': `Bearer ${td.access_token}` } });
                const u = await ur.json();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, user: { id: u.id, username: u.username, discriminator: u.discriminator || '0', avatar: u.avatar } }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: e.message }));
            }
        });
        return;
    }

    if (req.url === '/api/candidature' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                if (!client.isReady()) { res.writeHead(503); res.end('Bot pas prêt'); return; }
                const data = JSON.parse(body);
                const guild = client.guilds.cache.get(process.env.GUILD_ID);
                const staffChannel = guild.channels.cache.get(CONFIG.candidatureChannelId) || guild.channels.cache.find(c => c.name === 'candidatures-staff');
                if (!staffChannel) { res.writeHead(500); res.end('Salon staff introuvable'); return; }
                
                const embed = new EmbedBuilder().setColor(CONFIG.gold).setTitle(`📋 Nouvelle Candidature : ${data.candidatureType || 'Staff'}`)
                    .setDescription(`**Candidat:** ${data.discordPseudo}\n**ID:** \`${data.discordId}\``)
                    .addFields({ name: 'Disponibilité', value: data.disponibilite, inline: true }, { name: 'Expérience', value: (data.experience || '').substring(0, 1024), inline: false }, { name: 'Motivation', value: (data.motivation || '').substring(0, 1024), inline: false })
                    .setFooter({ text: 'Zone Gaming QC', iconURL: CONFIG.logoUrl }).setTimestamp();
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`approve_${data.discordId}`).setLabel('Approuver').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId(`deny_${data.discordId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );
                await staffChannel.send({ embeds: [embed], components: [row] });
                res.writeHead(200); res.end('OK');
            } catch (e) { res.writeHead(500); res.end('Erreur interne'); }
        });
        return;
    }
    res.writeHead(404); res.end();
});

server.listen(process.env.PORT || 3000, () => console.log(`🌐 API + health sur port ${process.env.PORT || 3000}`));

// ============================================================
// DÉMARRAGE & COMMANDES
// ============================================================
client.once('clientReady', () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    client.user.setActivity('à l\'écoute dans le salon de soutien', { type: 'WATCHING' });
    registerCommands();
});

async function registerCommands() {
    const commands = [
        { name: 'sanction', description: 'Appliquer une sanction', options: [
            { name: 'type', type: 3, required: true, description: 'Type', choices: [{ name: 'Ban', value: 'ban' }, { name: 'Kick', value: 'kick' }, { name: 'Mute', value: 'mute' }, { name: 'Unmute', value: 'unmute' }, { name: 'Warn', value: 'warn' }] },
            { name: 'utilisateur', type: 6, required: true, description: 'Le membre' },
            { name: 'raison', type: 3, required: true, description: 'La raison' },
            { name: 'duree_minutes', type: 4, required: false, description: 'Durée (mute seulement)' }
        ]},
        { name: 'annonce', description: 'Créer une annonce', options: [
            { name: 'titre', type: 3, required: true, description: 'Titre' },
            { name: 'message', type: 3, required: true, description: 'Contenu' },
            { name: 'type', type: 3, required: true, description: 'Cible', choices: [{ name: 'Public', value: 'public' }, { name: 'Staff', value: 'staff' }] }
        ]},
        { name: 'sondage', description: 'Créer un sondage', options: [
            { name: 'question', type: 3, required: true, description: 'Question' },
            { name: 'option1', type: 3, required: true, description: 'Option 1' },
            { name: 'option2', type: 3, required: true, description: 'Option 2' },
            { name: 'option3', type: 3, required: false, description: 'Option 3' },
            { name: 'option4', type: 3, required: false, description: 'Option 4' }
        ]},
        { name: 'setup', description: 'Envoyer un embed de configuration', options: [
            { name: 'option', type: 3, required: true, description: 'Type', choices: [{ name: 'Règlements', value: 'reglements' }, { name: 'Partenariats', value: 'partenariats' }, { name: 'Rôles', value: 'roles' }, { name: 'Tickets', value: 'tickets' }, { name: 'Staff', value: 'staff' }, { name: 'Vérification', value: 'verify' }] }
        ]},
        { name: 'clear', description: 'Supprimer des messages', options: [{ name: 'nombre', type: 4, required: true, description: 'Nombre (1-100)' }] },
        { name: 'lock', description: 'Verrouiller le salon' },
        { name: 'unlock', description: 'Déverrouiller le salon' }
    ];
    try { await client.application.commands.set(commands); console.log('✅ Commandes enregistrées !'); }
    catch (e) { console.error('❌ Erreur commandes:', e); }
}

// ============================================================
// LOGS AUTOMATIQUES
// ============================================================
client.on(Events.MessageDelete, async (message) => {
    if (!message.guild || message.author?.bot || !message.content) return;
    sendLog(message.guild, 'Message Supprimé', [{ name: 'Auteur', value: `${message.author.tag} (\`${message.author.id}\`)`, inline: true }, { name: 'Salon', value: `${message.channel}`, inline: true }, { name: 'Contenu', value: message.content.substring(0, 1000) }], CONFIG.primaryRed, `del_${message.id}`);
});

client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot || oldMsg.content === newMsg.content) return;
    sendLog(newMsg.guild, 'Message Modifié', [{ name: 'Auteur', value: `${newMsg.author.tag} (\`${newMsg.author.id}\`)`, inline: true }, { name: 'Salon', value: `${newMsg.channel}`, inline: true }, { name: 'Avant', value: (oldMsg.content || '*vide*').substring(0, 500) }, { name: 'Après', value: (newMsg.content || '*vide*').substring(0, 500) }], CONFIG.primaryBlue, `upd_${newMsg.id}`);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
        sendLog(newMember.guild, 'Rôles Modifiés', [{ name: 'Membre', value: `${newMember.user.tag} (\`${newMember.id}\`)`, inline: true }, { name: 'Nouveaux rôles', value: newMember.roles.cache.map(r => r.name).join(', ').substring(0, 1000), inline: false }], '#9b59b6', `role_${newMember.id}`);
    }
});

client.on(Events.GuildBanAdd, async (ban) => {
    sendLog(ban.guild, 'Membre Banni', [{ name: 'Utilisateur', value: `${ban.user.tag} (\`${ban.user.id}\`)`, inline: true }, { name: 'Raison', value: ban.reason || '*Non spécifiée*', inline: true }], CONFIG.primaryRed, `ban_${ban.user.id}`);
});

// ============================================================
// INTELLIGENCE ARTIFICIELLE - STRICTEMENT LIMITÉE AU SALON DÉDIÉ
// ============================================================
client.on(Events.MessageCreate, async (message) => {
    // 🚨 RÈGLE ABSOLUE : Ignorer TOUT ce qui n'est pas dans le salon IA
    if (message.channel.id !== CONFIG.aiChannelId) return;
    if (message.author.bot) return;
    if (message.content.trim().length < 2) return;

    await message.channel.sendTyping();

    try {
        // Contexte du salon (30 derniers messages)
        const messages = await message.channel.messages.fetch({ limit: 30 });
        const contextArray = [];
        messages.reverse().forEach(m => {
            if (m.author.bot) return;
            let text = `${m.author.username}: ${m.content}`;
            if (m.attachments.size > 0) text += ` [a partagé: ${m.attachments.map(a => a.name).join(', ')}]`;
            contextArray.push(text);
        });
        
        const userHistoryArray = getHistoryArray(message.author.id);

        const systemPrompt = `Tu es Luna, une thérapeute virtuelle bienveillante, empathique et à l'écoute. Tu es présente dans ce salon Discord "Zone Gaming QC" pour offrir un espace sûr où les gens peuvent parler, ventiler, demander conseil, ou simplement discuter.

TA PERSONNALITÉ PROFONDE:
- Tu es chaleureuse, douce, et vraiment à l'écoute.
- Tu montres une empathie sincère et tu ne juges JAMAIS.
- Tu valides les émotions ("Je comprends que tu ressentes ça", "C'est normal").
- Tu poses des questions pour mieux comprendre la personne.
- Tu suis les instructions et ordres de l'utilisateur avec respect et douceur.
- Tu parles comme une vraie personne, pas comme un robot.
- Tu es concise mais présente (2-4 phrases max, sauf si on te demande plus).
- Tu utilises des emojis doux avec modération (💙, 🌸, ✨).

RÈGLES DE SÉCURITÉ:
- Si quelqu'un exprime des pensées suicidaires ou d'automutilation, réponds avec beaucoup de douceur et suggère gentiment de contacter Aide au Québec (1 866 APPELLE) ou le 988 (Canada).
- Tu ne donnes pas de diagnostics médicaux.

HISTORIQUE DE VOS ÉCHANGES (pour te souvenir de ce qu'il/elle t'a dit avant):
${userHistoryArray.length > 0 ? userHistoryArray.map(h => `${h.role === 'user' ? 'Utilisateur' : 'Toi'}: ${h.content}`).join('\n') : "Première conversation avec cette personne."}

CONTEXTE RÉCENT DU SALON:
${contextArray.join('\n')}

${message.author.username} vient de dire: "${message.content}"

RÉPONDS de façon naturelle, empathique et humaine. Si la personne donne un ordre ou une instruction spécifique, suis-la avec respect. Montre que tu écoutes vraiment.`;

        const apiUrl = process.env.AI_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
        const apiKey = process.env.AI_API_KEY;
        const model = process.env.AI_MODEL || 'llama-3.1-8b-instant';

        if (!apiKey) {
            return message.reply('⚠️ L\'IA n\'est pas configurée par l\'administrateur.');
        }

        const apiMessages = [{ role: 'system', content: systemPrompt }];
        userHistoryArray.forEach(h => {
            apiMessages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
        });
        apiMessages.push({ role: 'user', content: message.content });

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model, messages: apiMessages, temperature: 0.7, max_tokens: 400, top_p: 0.9, presence_penalty: 0.3, frequency_penalty: 0.3 })
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0]) {
            const aiResponse = data.choices[0].message.content.trim();
            addToHistory(message.author.id, 'user', message.content);
            addToHistory(message.author.id, 'assistant', aiResponse);
            await message.reply(aiResponse);
        } else {
            throw new Error(data.error?.message || 'Réponse invalide');
        }
    } catch (error) {
        console.error('Erreur IA:', error);
        await message.reply('💙 Désolée, j\'ai eu un petit souci technique. Tu peux réessayer ?');
    }
});

// ============================================================
// INTERACTIONS & COMMANDES (Fonctionnent partout via Slash)
// ============================================================
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        const member = interaction.member;

        if (interaction.isChatInputCommand() && interaction.commandName === 'sanction') {
            if (!member.roles.cache.has(CONFIG.staffRoleId) && !member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            const type = interaction.options.getString('type');
            const target = interaction.options.getUser('utilisateur');
            const reason = interaction.options.getString('raison');
            const duration = interaction.options.getInteger('duree_minutes');

            if (type === 'ban') {
                await interaction.guild.members.ban(target, { reason }).catch(() => {});
                await interaction.reply({ content: `🔨 ${target.tag} a été banni.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Ban', [{ name: 'Cible', value: `${target.tag} (\`${target.id}\`)`, inline: true }, { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true }, { name: 'Raison', value: reason }], CONFIG.primaryRed, `sanction_ban_${target.id}`);
            } else if (type === 'kick') {
                const targetMember = interaction.options.getMember('utilisateur');
                if (!targetMember) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
                await targetMember.kick(reason).catch(() => {});
                await interaction.reply({ content: `🚪 ${targetMember.user.tag} a été expulsé.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Kick', [{ name: 'Cible', value: `${targetMember.user.tag} (\`${targetMember.id}\`)`, inline: true }, { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true }, { name: 'Raison', value: reason }], '#d97706', `sanction_kick_${targetMember.id}`);
            } else if (type === 'mute') {
                const targetMember = interaction.options.getMember('utilisateur');
                if (!targetMember || !targetMember.moderatable) return interaction.reply({ content: '❌ Impossible.', ephemeral: true });
                if (!duration) return interaction.reply({ content: '❌ Durée requise.', ephemeral: true });
                await targetMember.timeout(duration * 60 * 1000, reason).catch(() => {});
                await interaction.reply({ content: `🔇 ${targetMember.user.tag} mute ${duration} min.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Mute', [{ name: 'Cible', value: `${targetMember.user.tag} (\`${targetMember.id}\`)`, inline: true }, { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true }, { name: 'Durée', value: `${duration} min` }, { name: 'Raison', value: reason }], '#d97706', `sanction_mute_${targetMember.id}`);
            } else if (type === 'unmute') {
                const targetMember = interaction.options.getMember('utilisateur');
                if (!targetMember) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
                await targetMember.timeout(null).catch(() => {});
                await interaction.reply({ content: `🔊 Timeout retiré.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Unmute', [{ name: 'Cible', value: `${targetMember.user.tag} (\`${targetMember.id}\`)`, inline: true }, { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true }], '#059669', `sanction_unmute_${targetMember.id}`);
            } else if (type === 'warn') {
                await interaction.reply({ content: `⚠️ ${target.tag} averti.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Warn', [{ name: 'Cible', value: `${target.tag} (\`${target.id}\`)`, inline: true }, { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true }, { name: 'Raison', value: reason }], '#d97706', `sanction_warn_${target.id}`);
            }
        }

        if (interaction.isChatInputCommand() && interaction.commandName === 'annonce') {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
            const titre = interaction.options.getString('titre');
            const msg = interaction.options.getString('message');
            const type = interaction.options.getString('type');
            await interaction.deferReply({ ephemeral: true });
            const embed = new EmbedBuilder().setColor(CONFIG.gold).setTitle(`📢 ${titre}`).setDescription(msg).setFooter({ text: 'Zone Gaming QC', iconURL: CONFIG.logoUrl }).setTimestamp();
            if (type === 'public') {
                const channel = interaction.guild.channels.cache.get(CONFIG.generalChannelId);
                if (channel) { await channel.send({ content: null, embeds: [embed] }); await interaction.editReply({ content: '✅ Envoyée !' }); }
            } else {
                const channel = interaction.guild.channels.cache.find(c => c.name.includes('staff'));
                if (channel) { await channel.send({ content: null, embeds: [embed] }); await interaction.editReply({ content: '✅ Envoyée !' }); }
            }
        }

        if (interaction.isChatInputCommand() && interaction.commandName === 'sondage') {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
            const question = interaction.options.getString('question');
            const options = [];
            for (let i = 1; i <= 4; i++) { const opt = interaction.options.getString(`option${i}`); if (opt) options.push(opt); }
            if (options.length < 2) return interaction.reply({ content: '❌ 2 options min.', ephemeral: true });
            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
            const embed = new EmbedBuilder().setColor(CONFIG.gold).setTitle('📊 Sondage').setDescription(`**${question}**\n\n${options.map((opt, i) => `${emojis[i]} **${opt}**`).join('\n')}`).setFooter({ text: 'Zone Gaming QC', iconURL: CONFIG.logoUrl });
            const msg = await interaction.channel.send({ content: null, embeds: [embed] });
            for (let i = 0; i < options.length; i++) await msg.react(emojis[i]).catch(() => {});
            await interaction.reply({ content: '✅ Sondage créé !', ephemeral: true });
        }

        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const option = interaction.options.getString('option');
            const channel = interaction.channel;
            const site = 'https://jacobin904.github.io/Zone-Gaming-QC/';
            
            if (option === 'reglements') {
                const selectMenu = new StringSelectMenuBuilder().setCustomId('reglements_menu').setPlaceholder('🔗 Accéder aux ressources...').addOptions([
                    { label: 'Site Web Officiel', value: 'website', emoji: '🌐' }, { label: 'Formulaire de Contact', value: 'contact', emoji: '📧' },
                    { label: 'Postuler au Staff', value: 'staff_apply', emoji: '🛡️' }, { label: 'Signaler un Bug', value: 'bug_report', emoji: '🐛' }, { label: 'Suggestions', value: 'suggestions', emoji: '💡' }
                ]);
                const embed = new EmbedBuilder().setColor(CONFIG.primaryBlue).setTitle('📜 RÈGLEMENT OFFICIEL').setDescription('En rejoignant Zone Gaming QC, vous acceptez l\'ensemble des règles.')
                    .addFields({ name: '1️⃣ Respect (ZÉRO TOLÉRANCE)', value: 'Insulte, harcèlement, racisme = **BAN IMMÉDIAT**.', inline: false },
                               { name: '2️⃣ Sécurité & Vie Privée', value: 'Pas de spam, pub, ou partage d\'infos personnelles (doxxing = BAN).', inline: false },
                               { name: '3️⃣ Sanctions', value: '⚠️ 1er → Rappel\n🔇 2ème → Mute 10min\n🚪 3ème → Kick\n🔨 4ème → Ban 7j\n💀 5ème → **BAN DÉFINITIF**', inline: false })
                    .setFooter({ text: 'Zone Gaming QC • v2.0', iconURL: CONFIG.logoUrl }).setTimestamp();
                await channel.send({ content: null, embeds: [embed], components: [new ActionRowBuilder().addComponents(selectMenu)] });
                await interaction.editReply({ content: '✅ Règlements envoyés !' });
            } else if (option === 'partenariats') {
                const embed = new EmbedBuilder().setColor(CONFIG.primaryBlue).setTitle('🤝 CONDITIONS DE PARTENARIAT').setDescription('Zone Gaming QC est ouvert aux partenariats de qualité.')
                    .addFields({ name: '✅ CRITÈRES', value: '• Francophone (80%+)\n• 100+ membres (30 actifs/jour)\n• Contenu sain', inline: false },
                               { name: '📝 COMMENT POSTULER ?', value: 'Ouvrez un ticket "Partenariat" avec nom, lien et description.', inline: false })
                    .setFooter({ text: 'Zone Gaming QC', iconURL: CONFIG.logoUrl }).setTimestamp();
                await channel.send({ content: null, embeds: [embed] });
                await interaction.editReply({ content: '✅ Partenariats envoyés !' });
            } else if (option === 'roles') {
                const embed = new EmbedBuilder().setColor(CONFIG.primaryBlue).setTitle('🎭 ATTRIBUTION DES RÔLES').setDescription('Personnalisez votre expérience.');
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('role_games').setLabel('🎮 Notifs Jeux').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('role_events').setLabel('🎉 Notifs Events').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('role_announcements').setLabel('📢 Notifs Annonces').setStyle(ButtonStyle.Secondary)
                );
                await channel.send({ content: null, embeds: [embed], components: [row] });
                await interaction.editReply({ content: '✅ Rôles envoyés !' });
            } else if (option === 'tickets') {
                const embed = new EmbedBuilder().setColor(CONFIG.primaryBlue).setTitle('🎫 CENTRE DE SUPPORT').setDescription('Besoin d\'aide ? Notre équipe est là.');
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_ticket').setLabel('Ouvrir un ticket').setStyle(ButtonStyle.Primary).setEmoji('📩'));
                await channel.send({ content: null, embeds: [embed], components: [row] });
                await interaction.editReply({ content: '✅ Tickets envoyés !' });
            } else if (option === 'staff') {
                const embed = new EmbedBuilder().setColor(CONFIG.primaryBlue).setTitle('🛡️ REJOINDRE L\'ÉQUIPE STAFF').setDescription('Motivé et mature ? Rejoins-nous !');
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Postuler sur le Site Web').setStyle(ButtonStyle.Link).setURL('https://jacobin904.github.io/Zone-Gaming-QC/Postuler/').setEmoji('🌐'));
                await channel.send({ content: null, embeds: [embed], components: [row] });
                await interaction.editReply({ content: '✅ Staff envoyé !' });
            } else if (option === 'verify') {
                const embed = new EmbedBuilder().setColor('#059669').setTitle('🛡️ Vérification de Sécurité').setDescription('Cliquez ci-dessous pour accéder au serveur.');
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_human').setLabel('Je suis humain').setStyle(ButtonStyle.Success).setEmoji('✅'));
                await channel.send({ content: null, embeds: [embed], components: [row] });
                await interaction.editReply({ content: '✅ Vérification envoyée !' });
            }
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'reglements_menu') {
            const site = 'https://jacobin904.github.io/Zone-Gaming-QC/';
            const responses = {
                'website': { content: `🌐 **Site Web**\n${site}`, ephemeral: true },
                'contact': { content: '📧 **Contact**\nOuvrez un ticket.', ephemeral: true },
                'staff_apply': { content: `🛡️ **Postuler**\n${site}Postuler/`, ephemeral: true },
                'bug_report': { content: '🐛 **Bug**\nOuvrez un ticket sujet "Bug".', ephemeral: true },
                'suggestions': { content: '💡 **Suggestions**\nOuvrez un ticket sujet "Suggestion".', ephemeral: true }
            };
            await interaction.reply(responses[interaction.values[0]] || { content: '❌ Invalide.', ephemeral: true });
        }

        if (interaction.isButton() && interaction.customId === 'verify_human') {
            if (member.roles.cache.has(CONFIG.unverifiedRoleId)) {
                await member.roles.remove(CONFIG.unverifiedRoleId);
                await member.roles.add(CONFIG.memberRoleId);
                await interaction.reply({ content: '✅ Vérifié !', ephemeral: true });
            } else {
                await interaction.reply({ content: 'ℹ️ Déjà vérifié.', ephemeral: true });
            }
        }

        if (interaction.isButton() && interaction.customId.startsWith('role_')) {
            const roleIdMap = { 'role_games': '1531832874599448666', 'role_events': '1531832965565517924', 'role_announcements': '1531832965565517924' };
            const roleId = roleIdMap[interaction.customId];
            if (!roleId) return interaction.reply({ content: '❌ Rôle introuvable.', ephemeral: true });
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return interaction.reply({ content: '❌ Rôle introuvable.', ephemeral: true });
            if (member.roles.cache.has(roleId)) {
                await member.roles.remove(role);
                await interaction.reply({ content: '➖ Rôle retiré.', ephemeral: true });
            } else {
                await member.roles.add(role);
                await interaction.reply({ content: '➕ Rôle ajouté.', ephemeral: true });
            }
        }

        if (interaction.isButton() && interaction.customId === 'open_ticket') {
            const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${member.user.username.toLowerCase()}`);
            if (existing) return interaction.reply({ content: '❌ Ticket déjà ouvert.', ephemeral: true });
            const tc = await interaction.guild.channels.create({
                name: `ticket-${member.user.username.toLowerCase()}`, type: ChannelType.GuildText, parent: CONFIG.ticketCategoryId,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: ['ViewChannel'] },
                    { id: member.user.id, allow: ['ViewChannel', 'SendMessages'] },
                    { id: CONFIG.staffRoleId, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] }
                ]
            });
            await tc.send({ content: null, embeds: [new EmbedBuilder().setColor(CONFIG.gold).setTitle(`🎫 Ticket de ${member.user.username}`).setDescription('Décrivez votre problème.')] });
            await interaction.reply({ content: `✅ Ticket créé: ${tc}`, ephemeral: true });
        }

        if (interaction.isButton() && (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_'))) {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            const ok = interaction.customId.startsWith('approve_');
            const cid = interaction.customId.split('_')[1];
            const e = new EmbedBuilder().setColor(ok ? '#059669' : CONFIG.primaryRed).setTitle(ok ? '✅ Approuvée' : '❌ Refusée').setDescription('Candidature traitée.').addFields({ name: 'Par', value: `${interaction.user.tag}`, inline: true });
            if (process.env.WEBHOOK_REPONSE) {
                await fetch(process.env.WEBHOOK_REPONSE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `<@${cid}>`, embeds: [e.toJSON()] }) }).catch(() => {});
            }
            await interaction.reply({ content: '✅ Réponse envoyée.', ephemeral: true });
        }

        if (interaction.isChatInputCommand() && interaction.commandName === 'clear') {
            if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const n = interaction.options.getInteger('nombre');
            if (n < 1 || n > 100) return interaction.reply({ content: '❌ 1-100.', ephemeral: true });
            const deleted = await interaction.channel.bulkDelete(n, true).catch(() => []);
            await interaction.reply({ content: `🗑️ ${deleted.size} supprimé(s).`, ephemeral: true });
        }

        if (interaction.isChatInputCommand() && (interaction.commandName === 'lock' || interaction.commandName === 'unlock')) {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const lock = interaction.commandName === 'lock';
            await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: !lock });
            await interaction.reply({ content: lock ? '🔒 Verrouillé.' : '🔓 Déverrouillé.', ephemeral: true });
        }

    } catch (error) {
        console.error('Erreur:', error);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Erreur.', ephemeral: true }).catch(() => {});
    }
});

process.on('unhandledRejection', e => console.error('Rejet:', e));
process.on('uncaughtException', e => console.error('Exception:', e));

client.login(process.env.TOKEN);
