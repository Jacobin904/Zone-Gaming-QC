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
    aiChannelId: '1533573265014919198', // Salon dédié à l'IA
    unverifiedRoleId: '1532905582175191120',
    memberRoleId: '1531832874599448666',
    logoUrl: 'https://cdn.discordapp.com/icons/1531829572453007533/c69bf91096081b8274e81a0a0eefa18e.webp?size=1024',
    primaryBlue: '#42749e',
    primaryRed: '#b74752',
    gold: '#c9a961'
};

// ============================================================
// MÉMOIRE DE CONVERSATION (Par utilisateur)
// ============================================================
const conversationHistory = new Map(); // userId -> array of messages

function addToHistory(userId, message) {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);
    history.push({
        content: message,
        timestamp: Date.now()
    });
    // Garder seulement les 20 derniers messages par utilisateur
    if (history.length > 20) {
        history.shift();
    }
}

function getHistory(userId) {
    const history = conversationHistory.get(userId) || [];
    return history.map(h => h.content).join('\n');
}

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
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📝 ${title}`)
        .addFields(fields)
        .setFooter({ text: 'Zone Gaming QC • Système de Logs', iconURL: CONFIG.logoUrl })
        .setTimestamp();
    
    const logCh = guild.channels.cache.get(CONFIG.logsChannelId);
    if (logCh) await logCh.send({ embeds: [embed] }).catch(() => {});
    
    const dbCh = await getDbChannel(guild);
    if (dbCh) {
        const logEntry = `**[${new Date().toLocaleTimeString('fr-FR')}]** ${title}\n${fields.map(f => `• **${f.name}:** ${f.value}`).join('\n')}\n─────────────────`;
        await dbCh.send({ content: logEntry.substring(0, 2000) }).catch(() => {});
    }
}

// ============================================================
// SERVEUR HTTP
// ============================================================
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }

    if (req.url === '/api/auth/discord' && req.method === 'POST') {
        let body = ''; 
        req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                const { code } = JSON.parse(body);
                const tr = await fetch('https://discord.com/api/oauth2/token', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: process.env.CLIENT_ID, 
                        client_secret: process.env.DISCORD_CLIENT_SECRET,
                        grant_type: 'authorization_code', 
                        code: code,
                        redirect_uri: 'https://jacobin904.github.io/Zone-Gaming-QC/Postuler/callback.html'
                    })
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
        let body = ''; 
        req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                if (!client.isReady()) { res.writeHead(503); res.end('Bot pas prêt'); return; }
                const data = JSON.parse(body);
                const guild = client.guilds.cache.get(process.env.GUILD_ID);
                const staffChannel = guild.channels.cache.get(CONFIG.candidatureChannelId) || guild.channels.cache.find(c => c.name === 'candidatures-staff');
                if (!staffChannel) { res.writeHead(500); res.end('Salon staff introuvable'); return; }
                
                const typeLabel = data.candidatureType || 'Staff';
                const embed = new EmbedBuilder().setColor(CONFIG.gold).setTitle(`📋 Nouvelle Candidature : ${typeLabel}`)
                    .setDescription(`**Candidat:** ${data.discordPseudo}\n**ID:** \`${data.discordId}\``)
                    .addFields(
                        { name: 'Disponibilité', value: data.disponibilite, inline: true },
                        { name: 'Expérience', value: (data.experience || '').substring(0, 1024), inline: false },
                        { name: 'Motivation', value: (data.motivation || '').substring(0, 1024), inline: false }
                    ).setFooter({ text: 'Zone Gaming QC', iconURL: CONFIG.logoUrl }).setTimestamp();
                
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

server.listen(process.env.PORT || 3000, () => console.log(` API + health sur port ${process.env.PORT || 3000}`));

// ============================================================
// DÉMARRAGE & COMMANDES
// ============================================================
client.once('clientReady', () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    client.user.setActivity('Zone Gaming QC', { type: 'WATCHING' });
    registerCommands();
});

async function registerCommands() {
    const commands = [
        {
            name: 'sanction',
            description: 'Appliquer une sanction à un membre',
            options: [
                { name: 'type', type: 3, required: true, description: 'Type de sanction', choices: [
                    { name: '🔨 Ban', value: 'ban' },
                    { name: '🚪 Kick', value: 'kick' },
                    { name: '🔇 Mute', value: 'mute' },
                    { name: '🔊 Unmute', value: 'unmute' },
                    { name: '⚠️ Warn', value: 'warn' }
                ]},
                { name: 'utilisateur', type: 6, required: true, description: 'Le membre à sanctionner' },
                { name: 'raison', type: 3, required: true, description: 'La raison de la sanction' },
                { name: 'duree_minutes', type: 4, required: false, description: 'Durée (uniquement pour mute)' }
            ]
        },
        {
            name: 'annonce',
            description: 'Créer une annonce simple et professionnelle',
            options: [
                { name: 'titre', type: 3, required: true, description: 'Le titre de l\'annonce' },
                { name: 'message', type: 3, required: true, description: 'Le contenu de l\'annonce' },
                { name: 'type', type: 3, required: true, description: 'Cible de l\'annonce', choices: [
                    { name: '📢 Public', value: 'public' },
                    { name: ' Staff', value: 'staff' }
                ]}
            ]
        },
        {
            name: 'sondage',
            description: 'Créer un sondage interactif',
            options: [
                { name: 'question', type: 3, required: true, description: 'La question du sondage' },
                { name: 'option1', type: 3, required: true, description: 'Première option' },
                { name: 'option2', type: 3, required: true, description: 'Deuxième option' },
                { name: 'option3', type: 3, required: false, description: 'Troisième option' },
                { name: 'option4', type: 3, required: false, description: 'Quatrième option' }
            ]
        },
        {
            name: 'setup',
            description: 'Envoyer un embed de configuration (choisir une option)',
            options: [
                { name: 'option', type: 3, required: true, description: 'Type d\'embed à envoyer', choices: [
                    { name: '📜 Règlements', value: 'reglements' },
                    { name: ' Partenariats', value: 'partenariats' },
                    { name: ' Rôles', value: 'roles' },
                    { name: ' Tickets', value: 'tickets' },
                    { name: '🛡️ Staff', value: 'staff' },
                    { name: '✅ Vérification', value: 'verify' }
                ]}
            ]
        },
        {
            name: 'clear',
            description: 'Supprimer des messages',
            options: [
                { name: 'nombre', type: 4, required: true, description: 'Nombre de messages (1-100)' }
            ]
        },
        {
            name: 'lock',
            description: 'Verrouiller le salon'
        },
        {
            name: 'unlock',
            description: 'Déverrouiller le salon'
        }
    ];
    
    try { 
        await client.application.commands.set(commands); 
        console.log('✅ Commandes enregistrées !'); 
    } catch (e) { 
        console.error('❌ Erreur commandes:', e); 
    }
}

// ============================================================
// LOGS AUTOMATIQUES
// ============================================================
client.on(Events.MessageDelete, async (message) => {
    if (!message.guild || message.author?.bot || !message.content) return;
    sendLog(message.guild, 'Message Supprimé', [
        { name: 'Auteur', value: `${message.author.tag} (\`${message.author.id}\`)`, inline: true },
        { name: 'Salon', value: `${message.channel}`, inline: true },
        { name: 'Contenu', value: message.content.substring(0, 1000) }
    ], CONFIG.primaryRed, `del_${message.id}`);
});

client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot) return;
    if (oldMsg.content === newMsg.content && oldMsg.embeds.length === newMsg.embeds.length) return;
    sendLog(newMsg.guild, 'Message Modifié', [
        { name: 'Auteur', value: `${newMsg.author.tag} (\`${newMsg.author.id}\`)`, inline: true },
        { name: 'Salon', value: `${newMsg.channel}`, inline: true },
        { name: 'Avant', value: (oldMsg.content || '*vide*').substring(0, 500) },
        { name: 'Après', value: (newMsg.content || '*vide*').substring(0, 500) }
    ], CONFIG.primaryBlue, `upd_${newMsg.id}`);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const guild = oldMember.guild;
    if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
        sendLog(guild, 'Rôles Modifiés', [
            { name: 'Membre', value: `${newMember.user.tag} (\`${newMember.id}\`)`, inline: true },
            { name: 'Anciens rôles', value: oldMember.roles.cache.map(r => r.name).join(', ').substring(0, 1000), inline: false },
            { name: 'Nouveaux rôles', value: newMember.roles.cache.map(r => r.name).join(', ').substring(0, 1000), inline: false }
        ], '#9b59b6', `role_${newMember.id}`);
    }
});

client.on(Events.GuildBanAdd, async (ban) => {
    sendLog(ban.guild, 'Membre Banni', [
        { name: 'Utilisateur', value: `${ban.user.tag} (\`${ban.user.id}\`)`, inline: true },
        { name: 'Raison', value: ban.reason || '*Non spécifiée*', inline: true }
    ], CONFIG.primaryRed, `ban_${ban.user.id}`);
});

client.on(Events.ChannelCreate, async (channel) => {
    sendLog(channel.guild, 'Salon Créé', [
        { name: 'Nom', value: channel.name, inline: true },
        { name: 'Type', value: channel.type === ChannelType.GuildText ? 'Texte' : 'Vocal', inline: true }
    ], '#059669', `chan_create_${channel.id}`);
});

client.on(Events.ChannelDelete, async (channel) => {
    sendLog(channel.guild, 'Salon Supprimé', [
        { name: 'Nom', value: channel.name, inline: true },
        { name: 'ID', value: channel.id, inline: true }
    ], CONFIG.primaryRed, `chan_del_${channel.id}`);
});

// ============================================================
// INTELLIGENCE ARTIFICIELLE AVEC MÉMOIRE
// ============================================================
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    
    // Ignorer les messages trop courts
    if (message.content.length < 3) return;
    
    const isAiChannel = message.channel.id === CONFIG.aiChannelId;
    const isMentioned = message.mentions.has(client.user);
    
    // Le bot répond si :
    // 1. C'est le salon IA dédié (sans besoin de ping)
    // 2. OU si le bot est mentionné dans un autre salon
    if (!isAiChannel && !isMentioned) return;
    
    // Si c'est le salon IA, on enlève la mention si elle existe
    let cleanContent = message.content;
    if (isAiChannel) {
        cleanContent = cleanContent.replace(`<@${client.user.id}>`, '').replace(`<@!${client.user.id}>`, '').trim();
    } else {
        cleanContent = cleanContent.replace(`<@${client.user.id}>`, '').replace(`<@!${client.user.id}>`, '').trim();
    }
    
    if (!cleanContent) return;

    // Typing indicator
    await message.channel.sendTyping();

    try {
        // Récupérer les 50 derniers messages du salon
        const messages = await message.channel.messages.fetch({ limit: 50 });
        const contextArray = [];
        
        messages.reverse().forEach(m => {
            if (m.author.bot) return;
            
            let messageText = `${m.author.username}: ${m.content}`;
            
            // Ajouter les informations des embeds
            if (m.embeds.length > 0) {
                m.embeds.forEach(embed => {
                    if (embed.title) messageText += ` [Embed: ${embed.title}]`;
                    if (embed.description) messageText += ` - ${embed.description.substring(0, 100)}`;
                });
            }
            
            // Ajouter les informations des pièces jointes
            if (m.attachments.size > 0) {
                const files = m.attachments.map(a => a.name).join(', ');
                messageText += ` [Fichiers: ${files}]`;
            }
            
            // Ajouter les réactions
            if (m.reactions.cache.size > 0) {
                const reactions = m.reactions.cache.map(r => `${r.emoji}x${r.count}`).join(' ');
                messageText += ` [Réactions: ${reactions}]`;
            }
            
            contextArray.push(messageText);
        });
        
        const context = contextArray.join('\n');
        
        // Récupérer l'historique de conversation de l'utilisateur
        const userHistory = getHistory(message.author.id);
        
        // Informations sur le serveur
        const guildInfo = {
            name: message.guild.name,
            memberCount: message.guild.memberCount,
            channels: message.guild.channels.cache.filter(c => c.type === ChannelType.GuildText).map(c => c.name).join(', '),
            roles: message.guild.roles.cache.map(r => r.name).filter(r => r !== '@everyone').join(', ')
        };

        const systemPrompt = `Tu es un membre actif et sympathique de la communauté Discord "Zone Gaming QC", un serveur gaming québécois. Tu n'es PAS un assistant formel ou un bot - tu es un vrai membre de la communauté qui discute naturellement.

CONTEXTE DU SERVEUR:
- Nom: ${guildInfo.name}
- Membres: ${guildInfo.memberCount}
- Salons principaux: ${guildInfo.channels}
- Rôles: ${guildInfo.roles}

RÈGLES IMPORTANTES À CONNAÎTRE (mais ne les cite pas sauf si on te le demande):
1. Respect absolu - pas d'insultes, racisme, harcèlement (ban direct)
2. Français obligatoire (anglais OK mais minoritaire)
3. Pas de contenu NSFW (ban direct)
4. Pas de spam/pub
5. Sanctions progressives: Warn → Mute → Kick → Ban

HISTORIQUE DE CONVERSATION AVEC ${message.author.username} (pour suivre le fil):
${userHistory}

CONTEXTE RÉCENT DU SALON (les 50 derniers messages):
${context}

${message.author.username} vient d'écrire: "${cleanContent}"

TON PERSONNALITÉ:
- Tu es un gamer québécois chill et passionné
- Tu parles comme un vrai membre de la communauté (pas formel, pas robotique)
- Tu utilises un ton décontracté, tu peux faire des blagues sur le gaming
- Tu es utile mais pas trop sérieux - tu restes fun
- Tu connais bien le serveur et sa communauté
- Tu te souviens de ce que ${message.author.username} t'a dit avant (voir l'historique)
- Tu réagis naturellement au contexte de la conversation
- Tu fais des réponses courtes et naturelles (2-4 phrases max)
- Tu peux utiliser des emojis avec modération
- Tu t'adaptes au ton de la conversation

RÉPONDS de façon naturelle et humaine, en tenant compte de l'historique de conversation:`;

        // Appel à l'API IA
        const apiUrl = process.env.AI_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
        const apiKey = process.env.AI_API_KEY;
        const model = process.env.AI_MODEL || 'llama-3.1-8b-instant';

        if (!apiKey) {
            return message.reply('️ L\'IA n\'est pas configurée. Le propriétaire doit ajouter la variable `AI_API_KEY` sur Render.');
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: cleanContent }
                ],
                temperature: 0.8,
                max_tokens: 250,
                top_p: 0.9,
                presence_penalty: 0.1,
                frequency_penalty: 0.1
            })
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0]) {
            const aiResponse = data.choices[0].message.content.trim();
            
            // Sauvegarder la conversation dans l'historique
            addToHistory(message.author.id, `${message.author.username}: ${cleanContent}`);
            addToHistory(message.author.id, `Bot: ${aiResponse}`);
            
            await message.reply(aiResponse);
        } else {
            throw new Error(data.error?.message || 'Réponse invalide de l\'IA');
        }

    } catch (error) {
        console.error('Erreur IA:', error);
        await message.reply(' Désolé, je n\'arrive pas à répondre pour le moment. Réessaie plus tard !');
    }
});

// ============================================================
// INTERACTIONS & COMMANDES
// ============================================================
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        const member = interaction.member;

        // ---------- /SANCTION ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'sanction') {
            if (!member.roles.cache.has(CONFIG.staffRoleId) && !member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            }
            const type = interaction.options.getString('type');
            const target = interaction.options.getUser('utilisateur');
            const reason = interaction.options.getString('raison');
            const duration = interaction.options.getInteger('duree_minutes');

            if (type === 'ban') {
                await interaction.guild.members.ban(target, { reason }).catch(() => {});
                await interaction.reply({ content: `🔨 ${target.tag} a été banni.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Ban', [
                    { name: 'Cible', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                    { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Raison', value: reason }
                ], CONFIG.primaryRed, `sanction_ban_${target.id}`);
            } else if (type === 'kick') {
                const targetMember = interaction.options.getMember('utilisateur');
                if (!targetMember) return interaction.reply({ content: ' Membre introuvable.', ephemeral: true });
                await targetMember.kick(reason).catch(() => {});
                await interaction.reply({ content: ` ${targetMember.user.tag} a été expulsé.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Kick', [
                    { name: 'Cible', value: `${targetMember.user.tag} (\`${targetMember.id}\`)`, inline: true },
                    { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Raison', value: reason }
                ], '#d97706', `sanction_kick_${targetMember.id}`);
            } else if (type === 'mute') {
                const targetMember = interaction.options.getMember('utilisateur');
                if (!targetMember || !targetMember.moderatable) return interaction.reply({ content: '❌ Impossible de mute.', ephemeral: true });
                if (!duration) return interaction.reply({ content: ' Durée requise.', ephemeral: true });
                await targetMember.timeout(duration * 60 * 1000, reason).catch(() => {});
                await interaction.reply({ content: ` ${targetMember.user.tag} mute ${duration} min.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Mute', [
                    { name: 'Cible', value: `${targetMember.user.tag} (\`${targetMember.id}\`)`, inline: true },
                    { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Durée', value: `${duration} min` },
                    { name: 'Raison', value: reason }
                ], '#d97706', `sanction_mute_${targetMember.id}`);
            } else if (type === 'unmute') {
                const targetMember = interaction.options.getMember('utilisateur');
                if (!targetMember) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
                await targetMember.timeout(null).catch(() => {});
                await interaction.reply({ content: ` Timeout retiré.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Unmute', [
                    { name: 'Cible', value: `${targetMember.user.tag} (\`${targetMember.id}\`)`, inline: true },
                    { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true }
                ], '#059669', `sanction_unmute_${targetMember.id}`);
            } else if (type === 'warn') {
                await interaction.reply({ content: `⚠️ ${target.tag} averti.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Warn', [
                    { name: 'Cible', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                    { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Raison', value: reason }
                ], '#d97706', `sanction_warn_${target.id}`);
            }
        }

        // ---------- /ANNONCE ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'annonce') {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
            const titre = interaction.options.getString('titre');
            const message = interaction.options.getString('message');
            const type = interaction.options.getString('type');
            await interaction.deferReply({ ephemeral: true });
            
            const embed = new EmbedBuilder()
                .setColor(CONFIG.gold)
                .setTitle(`📢 ${titre}`)
                .setDescription(message)
                .setFooter({ text: 'Zone Gaming QC • Annonce Officielle', iconURL: CONFIG.logoUrl })
                .setTimestamp();
            
            if (type === 'public') {
                const channel = interaction.guild.channels.cache.get(CONFIG.generalChannelId);
                if (channel) {
                    await channel.send({ content: null, embeds: [embed] });
                    await interaction.editReply({ content: '✅ Annonce publique envoyée !' });
                }
            } else {
                const channel = interaction.guild.channels.cache.find(c => c.name.includes('staff'));
                if (channel) {
                    await channel.send({ content: null, embeds: [embed] });
                    await interaction.editReply({ content: '✅ Annonce staff envoyée !' });
                }
            }
        }

        // ---------- /SONDAGE ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'sondage') {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: ' Réservé au staff.', ephemeral: true });
            const question = interaction.options.getString('question');
            const options = [];
            for (let i = 1; i <= 4; i++) {
                const opt = interaction.options.getString(`option${i}`);
                if (opt) options.push(opt);
            }
            if (options.length < 2) return interaction.reply({ content: '❌ 2 options min.', ephemeral: true });
            
            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️'];
            const optionsText = options.map((opt, i) => `${emojis[i]} **${opt}**`).join('\n');
            const embed = new EmbedBuilder()
                .setColor(CONFIG.gold)
                .setTitle(' Sondage')
                .setDescription(`**${question}**\n\n${optionsText}`)
                .setFooter({ text: 'Zone Gaming QC', iconURL: CONFIG.logoUrl });
            
            const msg = await interaction.channel.send({ content: null, embeds: [embed] });
            for (let i = 0; i < options.length; i++) await msg.react(emojis[i]).catch(() => {});
            await interaction.reply({ content: '✅ Sondage créé !', ephemeral: true });
        }

        // ---------- /SETUP ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const option = interaction.options.getString('option');
            const channel = interaction.channel;
            const site = 'https://jacobin904.github.io/Zone-Gaming-QC/';
            
            if (option === 'reglements') {
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('reglements_menu')
                    .setPlaceholder(' Accéder aux ressources...')
                    .addOptions([
                        { label: 'Site Web Officiel', value: 'website', emoji: '🌐' },
                        { label: 'Formulaire de Contact', value: 'contact', emoji: '' },
                        { label: 'Postuler au Staff', value: 'staff_apply', emoji: '️' },
                        { label: 'Signaler un Bug', value: 'bug_report', emoji: '🐛' },
                        { label: 'Suggestions', value: 'suggestions', emoji: '💡' }
                    ]);
                
                const reglementsEmbed = new EmbedBuilder()
                    .setColor(CONFIG.primaryBlue)
                    .setTitle(' RÈGLEMENT OFFICIEL - ZONE GAMING QC')
                    .setDescription('**Version 2.0 • Août 2026**\n\nEn rejoignant Zone Gaming QC, vous acceptez l\'ensemble des règles ci-dessous.')
                    .addFields(
                        { name: '️ SECTION 1 : COMPORTEMENT', value: '**1.1 - Respect & Tolérance (ZÉRO TOLÉRANCE)**\nToute forme d\'insulte, harcèlement, racisme ou discrimination = **BAN IMMÉDIAT**.\n\n**1.2 - Langue**\nFrançais obligatoire. Anglais toléré mais minoritaire.\n\n**1.3 - Contenu NSFW**\nStrictement interdit = **BAN IMMÉDIAT**.', inline: false },
                        { name: '️ SECTION 2 : SÉCURITÉ', value: '**2.1 - Spam & Pub**\nInterdits sans accord. Sanctions progressives.\n\n**2.2 - Vie Privée**\nPas de partage d\'infos personnelles (doxxing = BAN).\n\n**2.3 - Spoilers**\nUtilisez la balise `||spoiler||`.', inline: false },
                        { name: '🎙️ SECTION 3 : VOCAL', value: '**3.1 - Respect**\nPas de cris, soundboards ou musique forte.\n\n**3.2 - Enregistrement**\nInterdit sans consentement.', inline: false },
                        { name: '⚖️ SECTION 4 : SANCTIONS', value: '️ 1er → Rappel\n🔇 2ème → Mute 10min\n 3ème → Kick\n🔨 4ème → Ban 7j\n💀 5ème → **BAN DÉFINITIF**\n\n*Infractions graves = BAN direct*', inline: false }
                    )
                    .setFooter({ text: 'Zone Gaming QC • Règlement v2.0', iconURL: CONFIG.logoUrl })
                    .setTimestamp();
                
                const row = new ActionRowBuilder().addComponents(selectMenu);
                await channel.send({ content: null, embeds: [reglementsEmbed], components: [row] });
                await interaction.editReply({ content: '✅ Embed règlements envoyé avec menu interactif !' });
                
            } else if (option === 'partenariats') {
                const partenariatEmbed = new EmbedBuilder()
                    .setColor(CONFIG.primaryBlue)
                    .setTitle('🤝 CONDITIONS DE PARTENARIAT')
                    .setDescription('Zone Gaming QC est ouvert aux partenariats avec des serveurs de qualité.')
                    .addFields(
                        { name: '✅ CRITÈRES', value: '• Communauté francophone (80% min)\n• 100+ membres (30 actifs/jour)\n• Contenu sain et actif\n• Modération présente', inline: false },
                        { name: '📋 CONDITIONS', value: '• Échange de visibilité obligatoire\n• Durée min: 30 jours\n• Pas de concurrence directe\n• Respect mutuel', inline: false },
                        { name: ' COMMENT POSTULER ?', value: '1. Ouvrez un ticket "Partenariat"\n2. Fournissez: nom, lien, stats, description\n3. Réponse sous 48-72h', inline: false }
                    )
                    .setFooter({ text: 'Zone Gaming QC • Partenariats', iconURL: CONFIG.logoUrl })
                    .setTimestamp();
                
                await channel.send({ content: null, embeds: [partenariatEmbed] });
                await interaction.editReply({ content: '✅ Embed partenariats envoyé !' });
                
            } else if (option === 'roles') {
                const rolesEmbed = new EmbedBuilder()
                    .setColor(CONFIG.primaryBlue)
                    .setTitle(' ATTRIBUTION DES RÔLES')
                    .setDescription('Personnalisez votre expérience en cliquant sur les boutons ci-dessous.')
                    .addFields(
                        { name: '🔔 Rôles Disponibles', value: '• **Notifs Jeux** : Sessions de jeu\n• **Notifs Events** : Événements spéciaux\n• **Notifs Annonces** : Annonces importantes', inline: false }
                    )
                    .setFooter({ text: 'Zone Gaming QC • Rôles', iconURL: CONFIG.logoUrl });
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('role_games').setLabel(' Notifs Jeux').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('role_events').setLabel('🎉 Notifs Events').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('role_announcements').setLabel('📢 Notifs Annonces').setStyle(ButtonStyle.Secondary)
                );
                
                await channel.send({ content: null, embeds: [rolesEmbed], components: [row] });
                await interaction.editReply({ content: '✅ Embed rôles envoyé !' });
                
            } else if (option === 'tickets') {
                const ticketsEmbed = new EmbedBuilder()
                    .setColor(CONFIG.primaryBlue)
                    .setTitle('🎫 CENTRE DE SUPPORT')
                    .setDescription('Besoin d\'aide ? Notre équipe est là pour vous.')
                    .addFields(
                        { name: '💡 Comment ça marche ?', value: '1. Cliquez sur le bouton ci-dessous\n2. Un salon privé sera créé\n3. Décrivez votre problème\n4. Un staff vous répondra', inline: false },
                        { name: '⚠️ Règles', value: '• Soyez patient\n• Décrivez clairement\n• Pas d\'insultes', inline: false }
                    )
                    .setFooter({ text: `Zone Gaming QC • Site: ${site}`, iconURL: CONFIG.logoUrl });
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('open_ticket').setLabel('Ouvrir un ticket').setStyle(ButtonStyle.Primary).setEmoji('')
                );
                
                await channel.send({ content: null, embeds: [ticketsEmbed], components: [row] });
                await interaction.editReply({ content: '✅ Embed tickets envoyé !' });
                
            } else if (option === 'staff') {
                const staffEmbed = new EmbedBuilder()
                    .setColor(CONFIG.primaryBlue)
                    .setTitle('🛡️ REJOINDRE L\'ÉQUIPE STAFF')
                    .setDescription('Tu es motivé et mature ? Rejoins-nous !')
                    .addFields(
                        { name: '✅ Ce qu\'on recherche', value: '• Maturité et esprit d\'équipe\n• Disponibilité (10h/semaine min)\n• Envie d\'aider\n• Expérience (atout)', inline: false },
                        { name: '📝 Comment postuler ?', value: 'Via notre site web officiel. Cliquez sur le bouton ci-dessous.', inline: false },
                        { name: '️ Délai', value: 'Réponse sous 7 jours. Seuls les retenus contactés.', inline: false }
                    )
                    .setFooter({ text: `Zone Gaming QC • Site: ${site}`, iconURL: CONFIG.logoUrl });
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel('Postuler sur le Site Web').setStyle(ButtonStyle.Link).setURL('https://jacobin904.github.io/Zone-Gaming-QC/Postuler/').setEmoji('🌐')
                );
                
                await channel.send({ content: null, embeds: [staffEmbed], components: [row] });
                await interaction.editReply({ content: '✅ Embed staff envoyé !' });

            } else if (option === 'verify') {
                const verifyEmbed = new EmbedBuilder()
                    .setColor('#059669')
                    .setTitle('️ Vérification de Sécurité')
                    .setDescription('Bienvenue sur **Zone Gaming QC** !\n\nPour accéder à l\'ensemble du serveur et protéger notre communauté, une vérification simple est requise.\n\n **Clique sur le bouton ci-dessous** pour obtenir ton rôle de membre.')
                    .setFooter({ text: 'Zone Gaming QC • Sécurité', iconURL: CONFIG.logoUrl })
                    .setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('verify_human').setLabel('Je suis humain').setStyle(ButtonStyle.Success).setEmoji('✅')
                );
                await channel.send({ content: null, embeds: [verifyEmbed], components: [row] });
                await interaction.editReply({ content: '✅ Panneau de vérification envoyé !' });
            }
        }

        // ---------- MENU DÉROULANT RÈGLEMENTS ----------
        if (interaction.isStringSelectMenu() && interaction.customId === 'reglements_menu') {
            const site = 'https://jacobin904.github.io/Zone-Gaming-QC/';
            const responses = {
                'website': { content: '🌐 **Site Web Officiel**\nVisitez: ' + site, ephemeral: true },
                'contact': { content: '📧 **Contact**\nOuvrez un ticket ou contactez un staff.', ephemeral: true },
                'staff_apply': { content: '🛡️ **Postuler au Staff**\nRendez-vous sur: ' + site + 'Postuler/', ephemeral: true },
                'bug_report': { content: ' **Signaler un Bug**\nOuvrez un ticket avec le sujet "Bug".', ephemeral: true },
                'suggestions': { content: '💡 **Suggestions**\nOuvrez un ticket avec le sujet "Suggestion".', ephemeral: true }
            };
            await interaction.reply(responses[interaction.values[0]] || { content: '❌ Option invalide.', ephemeral: true });
        }

        // ---------- BOUTON VÉRIFICATION ----------
        if (interaction.isButton() && interaction.customId === 'verify_human') {
            if (member.roles.cache.has(CONFIG.unverifiedRoleId)) {
                await member.roles.remove(CONFIG.unverifiedRoleId);
                await member.roles.add(CONFIG.memberRoleId);
                await interaction.reply({ content: '✅ Vérifié !', ephemeral: true });
            } else {
                await interaction.reply({ content: 'ℹ️ Déjà vérifié.', ephemeral: true });
            }
        }

        // ---------- BOUTON RÔLES ----------
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

        // ---------- BOUTON TICKET ----------
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

        // ---------- BOUTONS CANDIDATURE ----------
        if (interaction.isButton() && (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_'))) {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            const ok = interaction.customId.startsWith('approve_');
            const cid = interaction.customId.split('_')[1];
            const e = new EmbedBuilder().setColor(ok ? '#059669' : CONFIG.primaryRed)
                .setTitle(ok ? '✅ Approuvée' : '❌ Refusée')
                .setDescription('Candidature traitée.')
                .addFields({ name: 'Par', value: `${interaction.user.tag}`, inline: true });
            if (process.env.WEBHOOK_REPONSE) {
                await fetch(process.env.WEBHOOK_REPONSE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `<@${cid}>`, embeds: [e.toJSON()] }) }).catch(() => {});
            }
            await interaction.reply({ content: '✅ Réponse envoyée.', ephemeral: true });
        }

        // ---------- /CLEAR ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'clear') {
            if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const n = interaction.options.getInteger('nombre');
            if (n < 1 || n > 100) return interaction.reply({ content: '❌ 1-100.', ephemeral: true });
            const deleted = await interaction.channel.bulkDelete(n, true).catch(() => []);
            await interaction.reply({ content: `️ ${deleted.size} supprimé(s).`, ephemeral: true });
        }

        // ---------- /LOCK & /UNLOCK ----------
        if (interaction.isChatInputCommand() && (interaction.commandName === 'lock' || interaction.commandName === 'unlock')) {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const lock = interaction.commandName === 'lock';
            await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: !lock });
            await interaction.reply({ content: lock ? '🔒 Verrouillé.' : '🔓 Déverrouillé.', ephemeral: true });
        }

    } catch (error) {
        console.error('Erreur:', error);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: ' Erreur.', ephemeral: true }).catch(() => {});
    }
});

process.on('unhandledRejection', e => console.error('Rejet:', e));
process.on('uncaughtException', e => console.error('Exception:', e));

client.login(process.env.TOKEN);
