const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionFlagsBits, Events, ChannelType
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
        GatewayIntentBits.GuildModeration, // Nécessaire pour les logs de modération/bans
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// ============================================================
// CONFIGURATION (IDs de ton serveur)
// ============================================================
const CONFIG = {
    welcomeChannelId: '1531832075454255216',
    goodbyeChannelId: '1531833131823267901',
    birthdayChannelId: '1531833131823267901',
    staffRoleId: '1531835193395122186',
    logsChannelId: '1531829572914511955',       // 📊・logs-modération
    ticketCategoryId: '1531833907438289018',
    candidatureChannelId: '1533106862386446468',
    reglementsChannelId: '1531831739431911486',
    generalChannelId: '1531833131823267901',
    verifyChannelId: '1532906707850625236',     // vérification
    unverifiedRoleId: '1532905582175191120',    // Non vérifié
    memberRoleId: '1531832874599448666',        // Membre
    linkWhitelist: ['discord.gg/d8g2eztfbM', 'jacobin904.github.io']
};

// ============================================================
// BASE DE DONNÉES DISCORD (Persistance)
// ============================================================
const dbCache = new Map();

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

async function loadTable(guild, table) {
    const key = `${guild.id}:${table}`;
    if (dbCache.has(key)) return dbCache.get(key);
    const ch = await getDbChannel(guild);
    if (!ch) { dbCache.set(key, {}); return {}; }
    try {
        const msgs = await ch.messages.fetch({ limit: 100 });
        let json = '';
        msgs.filter(m => m.content.startsWith(`TABLE:${table}:`))
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .forEach(m => { json += m.content.slice(`TABLE:${table}:`.length); });
        const data = json ? JSON.parse(json) : {};
        dbCache.set(key, data);
        return data;
    } catch (e) { dbCache.set(key, {}); return {}; }
}

async function saveTable(guild, table, data) {
    const key = `${guild.id}:${table}`;
    dbCache.set(key, data);
    const ch = await getDbChannel(guild);
    if (!ch) return;
    try {
        const msgs = await ch.messages.fetch({ limit: 100 });
        const old = msgs.filter(m => m.content.startsWith(`TABLE:${table}:`));
        for (const [, m] of old) { await m.delete().catch(() => {}); }
        const json = JSON.stringify(data);
        const prefix = `TABLE:${table}:`;
        if (json.length <= 1900 - prefix.length) {
            await ch.send({ content: prefix + json });
        } else {
            await ch.send({ content: prefix + json.slice(0, 1900 - prefix.length) });
        }
    } catch (e) {}
}

// ============================================================
// SYSTÈME DE LOGS UNIFIÉ (Visuel + Base de données)
// ============================================================
async function sendLog(guild, title, fields) {
    const embed = new EmbedBuilder()
        .setColor('#c9a961')
        .setTitle(`📝 ${title}`)
        .addFields(fields)
        .setFooter({ text: 'Zone Gaming QC Logs' })
        .setTimestamp();

    // 1. Envoi dans le salon de logs visuel
    const logCh = guild.channels.cache.get(CONFIG.logsChannelId);
    if (logCh) await logCh.send({ embeds: [embed] }).catch(() => {});

    // 2. Sauvegarde dans la base de données Discord
    const logs = await loadTable(guild, 'system_logs');
    if (!logs.history) logs.history = [];
    logs.history.push({
        title,
        fields: fields.map(f => ({ name: f.name, value: f.value })),
        timestamp: Date.now()
    });
    // Garder seulement les 200 derniers logs pour ne pas surcharger
    if (logs.history.length > 200) logs.history = logs.history.slice(-200);
    await saveTable(guild, 'system_logs', logs);
}

// ============================================================
// SERVEUR HTTP (Render + API)
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
                    body: new URLSearchParams({
                        client_id: process.env.CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET,
                        grant_type: 'authorization_code', code,
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
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                if (!client.isReady()) { res.writeHead(503); res.end('Bot pas prêt'); return; }
                const data = JSON.parse(body);
                const guild = client.guilds.cache.get(process.env.GUILD_ID);
                const staffChannel = guild.channels.cache.get(CONFIG.candidatureChannelId) || guild.channels.cache.find(c => c.name === 'candidatures-staff');
                if (!staffChannel) { res.writeHead(500); res.end('Salon staff introuvable'); return; }
                
                const typeLabel = data.candidatureType || 'Staff';
                const embed = new EmbedBuilder().setColor('#c9a961').setTitle(`📋 Nouvelle Candidature : ${typeLabel}`)
                    .setDescription(`**Candidat:** ${data.discordPseudo}\n**ID:** \`${data.discordId}\``)
                    .addFields(
                        { name: 'Disponibilité', value: data.disponibilite, inline: true },
                        { name: 'Expérience', value: (data.experience || '').substring(0, 1024), inline: false },
                        { name: 'Motivation', value: (data.motivation || '').substring(0, 1024), inline: false }
                    ).setFooter({ text: 'Zone Gaming QC' }).setTimestamp();
                
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
    client.user.setActivity('Zone Gaming QC', { type: 'WATCHING' });
    registerCommands();
    startBirthdayChecker();
});

async function registerCommands() {
    const commands = [
        { name: 'ban', description: 'Bannir un utilisateur', options: [{ name: 'utilisateur', type: 6, required: true }, { name: 'raison', type: 3, required: false }] },
        { name: 'kick', description: 'Expulser un utilisateur', options: [{ name: 'utilisateur', type: 6, required: true }, { name: 'raison', type: 3, required: false }] },
        { name: 'mute', description: 'Mettre en timeout', options: [{ name: 'utilisateur', type: 6, required: true }, { name: 'duree_minutes', type: 4, required: true }, { name: 'raison', type: 3, required: false }] },
        { name: 'unmute', description: 'Retirer le timeout', options: [{ name: 'utilisateur', type: 6, required: true }] },
        { name: 'warn', description: 'Avertir un utilisateur', options: [{ name: 'utilisateur', type: 6, required: true }, { name: 'raison', type: 3, required: true }] },
        { name: 'clear', description: 'Supprimer des messages', options: [{ name: 'nombre', type: 4, required: true }] },
        { name: 'lock', description: 'Verrouiller le salon' },
        { name: 'unlock', description: 'Déverrouiller le salon' },
        { name: 'setup', description: 'Envoyer les embeds pros', options: [{ name: 'type', type: 3, required: true, choices: [{ name: '📜 Règlements', value: 'rules' }, { name: '🎭 Rôles', value: 'roles' }, { name: '🎫 Tickets', value: 'tickets' }, { name: '🛡️ Staff', value: 'staff' }, { name: '🚀 TOUT', value: 'all' }] }] },
        { name: 'setup-ticket', description: 'Panneau de ticket', options: [{ name: 'salon', type: 7, required: true, channel_types: [0] }] },
        { name: 'setup-verify', description: 'Envoyer le panneau de vérification humaine' },
        { name: 'role-menu', description: 'Menu de rôles', options: [{ name: 'role1', type: 8, required: true }, { name: 'role2', type: 8, required: false }, { name: 'role3', type: 8, required: false }] },
        { name: 'birthday', description: 'Gérer ton anniversaire', options: [{ name: 'set', type: 1, options: [{ name: 'jour', type: 4, required: true }, { name: 'mois', type: 4, required: true }] }, { name: 'remove', type: 1 }, { name: 'list', type: 1 }] },
        { name: 'translate', description: 'Traduire un texte', options: [{ name: 'texte', type: 3, required: true }, { name: 'langue', type: 3, required: true }] }
    ];
    try { await client.application.commands.set(commands); console.log('✅ Commandes enregistrées !'); }
    catch (e) { console.error('❌ Erreur commandes:', e); }
}

// ============================================================
// LOGS AUTOMATIQUES (Events Discord)
// ============================================================
client.on(Events.MessageDelete, async (message) => {
    if (!message.guild || message.author?.bot || !message.content) return;
    sendLog(message.guild, 'Message Supprimé', [
        { name: 'Auteur', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
        { name: 'Salon', value: `${message.channel}`, inline: true },
        { name: 'Contenu', value: message.content.substring(0, 1000) }
    ]);
});

client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot || oldMsg.content === newMsg.content) return;
    sendLog(newMsg.guild, 'Message Modifié', [
        { name: 'Auteur', value: `${newMsg.author} (\`${newMsg.author.id}\`)`, inline: true },
        { name: 'Salon', value: `${newMsg.channel}`, inline: true },
        { name: 'Avant', value: (oldMsg.content || '*vide*').substring(0, 500) },
        { name: 'Après', value: (newMsg.content || '*vide*').substring(0, 500) }
    ]);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const guild = oldMember.guild;
    // Changement de rôle
    const oldRoles = oldMember.roles.cache.map(r => r.name).join(', ') || 'Aucun';
    const newRoles = newMember.roles.cache.map(r => r.name).join(', ') || 'Aucun';
    if (oldRoles !== newRoles) {
        sendLog(guild, 'Rôles Modifiés', [
            { name: 'Membre', value: `${newMember.user} (\`${newMember.id}\`)`, inline: true },
            { name: 'Anciens rôles', value: oldRoles.substring(0, 1000), inline: false },
            { name: 'Nouveaux rôles', value: newRoles.substring(0, 1000), inline: false }
        ]);
    }
    // Changement de pseudo
    if (oldMember.nickname !== newMember.nickname) {
        sendLog(guild, 'Pseudo Modifié', [
            { name: 'Membre', value: `${newMember.user} (\`${newMember.id}\`)`, inline: true },
            { name: 'Ancien pseudo', value: oldMember.nickname || '*Aucun*', inline: true },
            { name: 'Nouveau pseudo', value: newMember.nickname || '*Aucun*', inline: true }
        ]);
    }
});

client.on(Events.GuildBanAdd, async (ban) => {
    sendLog(ban.guild, 'Membre Banni', [
        { name: 'Utilisateur', value: `${ban.user.tag} (\`${ban.user.id}\`)`, inline: true },
        { name: 'Raison', value: ban.reason || '*Non spécifiée*', inline: true }
    ]);
});

client.on(Events.ChannelCreate, async (channel) => {
    sendLog(channel.guild, 'Salon Créé', [
        { name: 'Nom', value: channel.name, inline: true },
        { name: 'Type', value: channel.type === ChannelType.GuildText ? 'Texte' : 'Vocal', inline: true }
    ]);
});

client.on(Events.ChannelDelete, async (channel) => {
    sendLog(channel.guild, 'Salon Supprimé', [
        { name: 'Nom', value: channel.name, inline: true },
        { name: 'ID', value: channel.id, inline: true }
    ]);
});

// ============================================================
// ANTI-SPAM / ANTI-RAID / WELCOME
// ============================================================
const joinLog = new Map();
function checkRaid(guild) {
    const now = Date.now();
    let arr = joinLog.get(guild.id) || [];
    arr.push(now);
    arr = arr.filter(t => now - t < 10000);
    joinLog.set(guild.id, arr);
    return arr.length >= 6;
}

client.on(Events.GuildMemberAdd, async (member) => {
    if (checkRaid(member.guild)) {
        const logCh = member.guild.channels.cache.get(CONFIG.logsChannelId);
        if (logCh) await logCh.send({ content: `<@&${CONFIG.staffRoleId}> 🚨 **ALERTE RAID** : Plusieurs joins rapides détectés.` }).catch(() => {});
    }
    const channel = member.guild.channels.cache.get(CONFIG.welcomeChannelId);
    if (channel) {
        const embed = new EmbedBuilder().setColor('#c9a961').setTitle('🎉 Bienvenue sur Zone Gaming QC !')
            .setDescription(`Salut ${member} ! 🍁\n📜 Lis les règles dans <#${CONFIG.reglementsChannelId}>\n💬 Présente-toi dans <#${CONFIG.generalChannelId}>`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true })).setFooter({ text: `Membre n°${member.guild.memberCount}` }).setTimestamp();
        await channel.send({ content: `${member}`, embeds: [embed] }).catch(() => {});
    }
    // Log join
    sendLog(member.guild, 'Nouveau Membre', [
        { name: 'Utilisateur', value: `${member.user} (\`${member.id}\`)`, inline: true },
        { name: 'Compte créé le', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
    ]);
});

client.on(Events.GuildMemberRemove, async (member) => {
    const channel = member.guild.channels.cache.get(CONFIG.goodbyeChannelId);
    if (channel) {
        const embed = new EmbedBuilder().setColor('#dc2626').setTitle('👋 Départ')
            .setDescription(`${member.user.tag} a quitté le serveur.`).setThumbnail(member.user.displayAvatarURL({ dynamic: true })).setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => {});
    }
    sendLog(member.guild, 'Membre Parti', [
        { name: 'Utilisateur', value: `${member.user} (\`${member.id}\`)`, inline: true },
        { name: 'A rejoint le', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true }
    ]);
});

// ============================================================
// INTERACTIONS & COMMANDES
// ============================================================
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        const member = interaction.member;

        // ---------- /SETUP-VERIFY (Vérification Humaine) ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup-verify') {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            
            const embed = new EmbedBuilder()
                .setColor('#c9a961')
                .setTitle('🛡️ Vérification de Sécurité')
                .setDescription('Pour accéder au serveur, clique sur le bouton ci-dessous.\n*Ceci confirme que tu es un humain et que tu acceptes les règles.*')
                .setFooter({ text: 'Zone Gaming QC' });
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verify_human').setLabel('Je suis humain').setStyle(ButtonStyle.Success).setEmoji('✅')
            );
            
            await interaction.channel.send({ embeds: [embed], components: [row] });
            await interaction.reply({ content: '✅ Panneau de vérification envoyé !', ephemeral: true });
        }

        // ---------- BOUTON DE VÉRIFICATION ----------
        if (interaction.isButton() && interaction.customId === 'verify_human') {
            if (member.roles.cache.has(CONFIG.unverifiedRoleId)) {
                await member.roles.remove(CONFIG.unverifiedRoleId);
                await member.roles.add(CONFIG.memberRoleId);
                await interaction.reply({ content: '✅ Vérification réussie ! Bienvenue sur Zone Gaming QC.', ephemeral: true });
                
                sendLog(interaction.guild, 'Utilisateur Vérifié', [
                    { name: 'Utilisateur', value: `${member.user} (\`${member.id}\`)`, inline: true },
                    { name: 'Action', value: 'Rôle "Non vérifié" retiré, rôle "Membre" ajouté', inline: false }
                ]);
            } else if (member.roles.cache.has(CONFIG.memberRoleId)) {
                await interaction.reply({ content: 'ℹ️ Tu es déjà vérifié !', ephemeral: true });
            } else {
                await interaction.reply({ content: '❌ Erreur : Tu n\'as pas le rôle "Non vérifié".', ephemeral: true });
            }
        }

        // ---------- /SETUP (Embeds Pros) ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const type = interaction.options.getString('type');
            const channel = interaction.channel;
            await interaction.deferReply({ ephemeral: true });
            const site = 'https://jacobin904.github.io/Zone-Gaming-QC/';
            const ico = 'https://cdn.discordapp.com/icons/1531829572453007533/c69bf91096081b8274e81a0a0eefa18e.webp?size=1024';
            
            if (type === 'rules' || type === 'all') {
                await channel.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('📜 Règlements de Zone Gaming QC')
                    .setDescription('En rejoignant ce serveur, vous acceptez les règles suivantes.')
                    .addFields({ name: '1️⃣ Respect', value: 'Insultes, harcèlement, discrimination = BAN IMMÉDIAT.', inline: false },
                               { name: '2️⃣ Langue', value: 'Français principal.', inline: true },
                               { name: '3️⃣ NSFW', value: 'Strictement interdit.', inline: true },
                               { name: '4️⃣ Spam & Pub', value: 'Interdits sans accord du staff.', inline: true },
                               { name: '5️⃣ Sanctions', value: '⚠️ Warn ➡️ 🔇 Mute ➡️ 🚪 Kick ➡️ 🔨 Ban.', inline: false })
                    .setFooter({ text: 'Zone Gaming QC', iconURL: ico }).setTimestamp()] });
            }
            if (type === 'roles' || type === 'all') {
                await channel.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🎭 Attribution des Rôles').setDescription('Clique sur les boutons ci-dessous.')],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('role_games').setLabel('🎮 Notifs Jeux').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('role_events').setLabel('🎉 Notifs Events').setStyle(ButtonStyle.Secondary))] });
            }
            if (type === 'tickets' || type === 'all') {
                await channel.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🎫 Centre de Support').setDescription('Besoin d\'aide ? Clique ci-dessous.')],
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_ticket').setLabel('Ouvrir un ticket').setStyle(ButtonStyle.Primary).setEmoji('📩'))] });
            }
            if (type === 'staff' || type === 'all') {
                await channel.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🛡️ Rejoindre l\'Équipe Staff').setDescription('Motivé ? Postule via notre site.')],
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Postuler sur le Site Web').setStyle(ButtonStyle.Link).setURL('https://jacobin904.github.io/Zone-Gaming-QC/Postuler/').setEmoji('🌐'))] });
            }
            await interaction.editReply({ content: `✅ Setup **${type === 'all' ? 'complet' : type}** envoyé !` });
        }

        // ---------- /BAN ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'ban') {
            if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const target = interaction.options.getUser('utilisateur');
            const reason = interaction.options.getString('raison') || 'Aucune raison';
            await interaction.guild.members.ban(target, { reason }).catch(() => {});
            const e = new EmbedBuilder().setColor('#dc2626').setTitle('🔨 Bannissement').setDescription(`${target} a été banni.`).addFields({ name: 'Raison', value: reason }).setFooter({ text: `Par ${interaction.user.tag}` }).setTimestamp();
            await interaction.reply({ embeds: [e] });
            sendLog(interaction.guild, 'Action Modération: Ban', [{ name: 'Cible', value: `${target.tag} (\`${target.id}\`)`, inline: true }, { name: 'Modérateur', value: `${interaction.user}`, inline: true }, { name: 'Raison', value: reason }]);
        }

        // ---------- /KICK ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'kick') {
            if (!member.permissions.has(PermissionFlagsBits.KickMembers)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const target = interaction.options.getMember('utilisateur');
            const reason = interaction.options.getString('raison') || 'Aucune raison';
            if (!target) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
            await target.kick(reason).catch(() => {});
            await interaction.reply({ content: `🚪 ${target.user} a été expulsé.`, ephemeral: true });
            sendLog(interaction.guild, 'Action Modération: Kick', [{ name: 'Cible', value: `${target.user.tag} (\`${target.id}\`)`, inline: true }, { name: 'Modérateur', value: `${interaction.user}`, inline: true }, { name: 'Raison', value: reason }]);
        }

        // ---------- /MUTE ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'mute') {
            if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const target = interaction.options.getMember('utilisateur');
            const mins = interaction.options.getInteger('duree_minutes');
            const reason = interaction.options.getString('raison') || 'Aucune raison';
            if (!target || !target.moderatable) return interaction.reply({ content: '❌ Impossible de mute ce membre.', ephemeral: true });
            await target.timeout(mins * 60 * 1000, reason).catch(() => {});
            await interaction.reply({ content: `🔇 ${target.user} mis en timeout ${mins} min.`, ephemeral: true });
            sendLog(interaction.guild, 'Action Modération: Mute', [{ name: 'Cible', value: `${target.user.tag} (\`${target.id}\`)`, inline: true }, { name: 'Modérateur', value: `${interaction.user}`, inline: true }, { name: 'Durée', value: `${mins} minutes` }, { name: 'Raison', value: reason }]);
        }

        // ---------- /UNMUTE ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'unmute') {
            if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const target = interaction.options.getMember('utilisateur');
            if (!target) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
            await target.timeout(null).catch(() => {});
            await interaction.reply({ content: `🔊 Timeout retiré pour ${target.user}.`, ephemeral: true });
            sendLog(interaction.guild, 'Action Modération: Unmute', [{ name: 'Cible', value: `${target.user.tag} (\`${target.id}\`)`, inline: true }, { name: 'Modérateur', value: `${interaction.user}`, inline: true }]);
        }

        // ---------- /WARN ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'warn') {
            if (!member.roles.cache.has(CONFIG.staffRoleId) && !member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const target = interaction.options.getUser('utilisateur');
            const reason = interaction.options.getString('raison');
            const data = await loadTable(interaction.guild, 'warns');
            if (!data[target.id]) data[target.id] = [];
            data[target.id].push({ by: interaction.user.id, reason, date: new Date().toISOString() });
            await saveTable(interaction.guild, 'warns', data);
            await interaction.reply({ content: `⚠️ ${target} a reçu un warn. Total: ${data[target.id].length}`, ephemeral: true });
            sendLog(interaction.guild, 'Action Modération: Warn', [{ name: 'Cible', value: `${target.tag} (\`${target.id}\`)`, inline: true }, { name: 'Modérateur', value: `${interaction.user}`, inline: true }, { name: 'Raison', value: reason }, { name: 'Total Warns', value: `${data[target.id].length}` }]);
            if (data[target.id].length >= 3) {
                const m = await interaction.guild.members.fetch(target.id).catch(() => null);
                if (m && m.moderatable) await m.timeout(10 * 60 * 1000, 'Auto: 3 warns').catch(() => {});
            }
        }

        // ---------- /CLEAR ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'clear') {
            if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const n = interaction.options.getInteger('nombre');
            if (n < 1 || n > 100) return interaction.reply({ content: '❌ Entre 1 et 100.', ephemeral: true });
            const deleted = await interaction.channel.bulkDelete(n, true).catch(() => []);
            await interaction.reply({ content: `🗑️ ${deleted.size} message(s) supprimé(s).`, ephemeral: true });
            sendLog(interaction.guild, 'Action Modération: Clear', [{ name: 'Modérateur', value: `${interaction.user}`, inline: true }, { name: 'Salon', value: `${interaction.channel}`, inline: true }, { name: 'Messages supprimés', value: `${deleted.size}`, inline: true }]);
        }

        // ---------- /LOCK & /UNLOCK ----------
        if (interaction.isChatInputCommand() && (interaction.commandName === 'lock' || interaction.commandName === 'unlock')) {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const lock = interaction.commandName === 'lock';
            await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: !lock }).catch(() => {});
            await interaction.reply({ content: lock ? '🔒 Salon verrouillé.' : '🔓 Salon déverrouillé.', ephemeral: true });
            sendLog(interaction.guild, `Salon ${lock ? 'Verrouillé' : 'Déverrouillé'}`, [{ name: 'Salon', value: `${interaction.channel}`, inline: true }, { name: 'Modérateur', value: `${interaction.user}`, inline: true }]);
        }

        // ---------- /ROLE-MENU ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'role-menu') {
            if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const roles = [1, 2, 3].map(i => interaction.options.getRole(`role${i}`)).filter(Boolean);
            const buttons = roles.map(r => new ButtonBuilder().setCustomId(`roletoggle_${r.id}`).setLabel(r.name).setStyle(ButtonStyle.Secondary));
            const rows = [];
            for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
            await interaction.channel.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🎭 Choisis tes rôles').setDescription('Clique sur les boutons pour activer/désactiver un rôle.')], components: rows });
            await interaction.reply({ content: '✅ Menu de rôles envoyé !', ephemeral: true });
        }

        // ---------- BOUTON : TOGGLE RÔLE ----------
        if (interaction.isButton() && interaction.customId.startsWith('roletoggle_')) {
            const roleId = interaction.customId.replace('roletoggle_', '');
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return interaction.reply({ content: '❌ Rôle introuvable.', ephemeral: true });
            if (member.roles.cache.has(roleId)) { await member.roles.remove(role).catch(() => {}); await interaction.reply({ content: `➖ Rôle **${role.name}** retiré.`, ephemeral: true }); }
            else { await member.roles.add(role).catch(() => {}); await interaction.reply({ content: `➕ Rôle **${role.name}** ajouté.`, ephemeral: true }); }
        }

        // ---------- BOUTON : OUVRIR TICKET ----------
        if (interaction.isButton() && interaction.customId === 'open_ticket') {
            const guild = interaction.guild;
            const existing = guild.channels.cache.find(c => c.name === `ticket-${member.user.username.toLowerCase()}` && c.parentId === CONFIG.ticketCategoryId);
            if (existing) return interaction.reply({ content: `❌ Ticket déjà ouvert : ${existing}`, ephemeral: true });
            const tc = await guild.channels.create({
                name: `ticket-${member.user.username.toLowerCase()}`, type: ChannelType.GuildText, parent: CONFIG.ticketCategoryId,
                permissionOverwrites: [
                    { id: guild.id, deny: ['ViewChannel'] },
                    { id: member.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                    { id: CONFIG.staffRoleId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'] }
                ]
            });
            await tc.send({ content: `${member}`, embeds: [new EmbedBuilder().setColor('#c9a961').setTitle(`🎫 Ticket de ${member.user.username}`).setDescription('Décris ton problème, l\'équipe arrive.')] });
            await interaction.reply({ content: `✅ Ticket créé : ${tc}`, ephemeral: true });
            sendLog(guild, 'Ticket Ouvert', [{ name: 'Utilisateur', value: `${member.user}`, inline: true }, { name: 'Salon', value: `${tc}`, inline: true }]);
        }

        // ---------- BOUTONS CANDIDATURE ----------
        if (interaction.isButton() && (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_'))) {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            const ok = interaction.customId.startsWith('approve_');
            const cid = interaction.customId.split('_')[1];
            // Ici, on pourrait ajouter une modale pour la raison, mais pour simplifier on envoie direct au webhook
            const color = ok ? 0x059669 : 0xdc2626;
            const e = new EmbedBuilder().setColor(color).setTitle(ok ? 'Candidature Approuvée !' : 'Candidature Refusée')
                .setDescription('Ta candidature a été traitée.').addFields({ name: 'Décision', value: ok ? '✅ Acceptée' : '❌ Refusée', inline: true }, { name: 'Par', value: `${interaction.user}`, inline: true });
            
            // Envoi au webhook de réponse (si configuré)
            if (process.env.WEBHOOK_REPONSE) {
                await fetch(process.env.WEBHOOK_REPONSE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `<@${cid}>`, embeds: [e.toJSON()] }) }).catch(() => {});
            }
            await interaction.reply({ content: `✅ Réponse envoyée.`, ephemeral: true });
        }

    } catch (error) {
        console.error('Erreur interaction:', error);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true }).catch(() => {});
    }
});

// Anniversaires (toutes les heures)
let lastBirthdayCheck = '';
function startBirthdayChecker() {
    setInterval(async () => {
        const now = new Date();
        const today = `${now.getDate()}/${now.getMonth() + 1}`;
        if (today === lastBirthdayCheck) return;
        lastBirthdayCheck = today;
        for (const [, guild] of client.guilds.cache) {
            const data = await loadTable(guild, 'birthdays');
            for (const [uid, b] of Object.entries(data)) {
                if (`${b.day}/${b.month}` === today) {
                    const ch = guild.channels.cache.get(CONFIG.birthdayChannelId);
                    if (ch) await ch.send({ content: `<@${uid}>`, embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🎂 Joyeux Anniversaire !').setDescription(`Aujourd'hui c'est l'anniversaire de <@${uid}> ! 🎉`)] }).catch(() => {});
                }
            }
        }
    }, 60 * 60 * 1000);
}

process.on('unhandledRejection', e => console.error('Rejet:', e));
process.on('uncaughtException', e => console.error('Exception:', e));

client.login(process.env.TOKEN);
