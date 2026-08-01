const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, PermissionFlagsBits, Events, ChannelType
} = require('discord.js');
const http = require('http');

// ✅ Vérification des variables d'environnement
if (!process.env.TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.error('❌ Variables manquantes sur Render !');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages
    ]
});

// ============================================================
// CONFIGURATION (IDs vérifiés sur ton serveur)
// ============================================================
const CONFIG = {
    welcomeChannelId: '1531832075454255216',     // 🎉・arrivée
    goodbyeChannelId: '1531833131823267901',     // 💬・général (fallback)
    birthdayChannelId: '1531833131823267901',    // 💬・général (fallback)
    staffRoleId: '1531835193395122186',          // Staff
    logsChannelId: '1531829572914511955',        // 📊・logs-modération
    ticketCategoryId: '1531833907438289018',     // 🎫 | CONTACT & SUPPORT
    candidatureChannelId: '1533106862386446468', // candidatures-staff
    reglementsChannelId: '1531831739431911486',  // 📜・règlements
    generalChannelId: '1531833131823267901',     // 💬・général
    linkWhitelist: ['discord.gg/d8g2eztfbM', 'jacobin904.github.io']
};

// ============================================================
// BASE DE DONNÉES DISCORD (persistance via salon privé)
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
            ],
            reason: 'Stockage interne du bot Zone Gaming QC'
        });
        const adminRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.Administrator));
        if (adminRole) await ch.permissionOverwrites.edit(adminRole, { ViewChannel: true });
        return ch;
    } catch (e) { console.error('Erreur création DB channel:', e); return null; }
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
    } catch (e) { console.error('Erreur loadTable:', e); dbCache.set(key, {}); return {}; }
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
        const max = 1900 - prefix.length;
        if (json.length <= max) {
            await ch.send({ content: prefix + json });
        } else {
            await ch.send({ content: prefix + json.slice(0, max) });
            console.warn(`Table ${table} tronquée (trop de données).`);
        }
    } catch (e) { console.error('Erreur saveTable:', e); }
}

// ============================================================
// SERVEUR HTTP (Render + API site web)
// ============================================================
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }

    // Authentification Discord OAuth2
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

    // Réception des candidatures du site web
    if (req.url === '/api/candidature' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                if (!client.isReady()) { res.writeHead(503); res.end('Bot pas prêt'); return; }
                const data = JSON.parse(body);
                const guild = client.guilds.cache.get(process.env.GUILD_ID);
                // Détection sécurisée par ID, fallback par nom
                const staffChannel = guild.channels.cache.get(CONFIG.candidatureChannelId)
                    || guild.channels.cache.find(c => c.name === 'candidatures-staff');
                if (!staffChannel) { res.writeHead(500); res.end('Salon staff introuvable'); return; }
                const embed = new EmbedBuilder().setColor('#c9a961').setTitle('📋 Nouvelle Candidature Staff')
                    .setDescription(`**Candidat:** ${data.discordPseudo}\n**ID:** \`${data.discordId}\``)
                    .addFields(
                        { name: 'Disponibilité', value: data.disponibilite, inline: true },
                        { name: 'Expérience', value: (data.experience || '').substring(0, 1024), inline: false },
                        { name: 'Motivation', value: (data.motivation || '').substring(0, 1024), inline: false })
                    .setFooter({ text: 'Zone Gaming QC | Candidature Staff' }).setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`approve_staff_${data.discordId}`).setLabel('Approuver').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId(`deny_staff_${data.discordId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger).setEmoji('❌'));
                await staffChannel.send({ embeds: [embed], components: [row] });
                res.writeHead(200); res.end('OK');
            } catch (e) { console.error('Erreur API candidature:', e); res.writeHead(500); res.end('Erreur interne'); }
        });
        return;
    }
    res.writeHead(404); res.end();
});
server.listen(process.env.PORT || 3000, () => console.log(`🌐 API + health sur port ${process.env.PORT || 3000}`));

// ============================================================
// DÉMARRAGE
// ============================================================
client.once('clientReady', () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    client.user.setActivity('Zone Gaming QC', { type: 'WATCHING' });
    registerCommands();
    startBirthdayChecker();
});

// ============================================================
// COMMANDES SLASH (toutes les options ont une description)
// ============================================================
async function registerCommands() {
    const commands = [
        { name: 'ban', description: 'Bannir un utilisateur', options: [
            { name: 'utilisateur', type: 6, required: true, description: 'L\'utilisateur à bannir' },
            { name: 'raison', type: 3, required: false, description: 'Raison du ban' }] },

        { name: 'kick', description: 'Expulser un utilisateur', options: [
            { name: 'utilisateur', type: 6, required: true, description: 'L\'utilisateur à expulser' },
            { name: 'raison', type: 3, required: false, description: 'Raison de l\'expulsion' }] },

        { name: 'mute', description: 'Mettre en timeout un utilisateur', options: [
            { name: 'utilisateur', type: 6, required: true, description: 'L\'utilisateur à mute' },
            { name: 'duree_minutes', type: 4, required: true, description: 'Durée en minutes' },
            { name: 'raison', type: 3, required: false, description: 'Raison du mute' }] },

        { name: 'unmute', description: 'Retirer le timeout d\'un utilisateur', options: [
            { name: 'utilisateur', type: 6, required: true, description: 'L\'utilisateur à unmute' }] },

        { name: 'warn', description: 'Avertir un utilisateur', options: [
            { name: 'utilisateur', type: 6, required: true, description: 'L\'utilisateur à avertir' },
            { name: 'raison', type: 3, required: true, description: 'Raison de l\'avertissement' }] },

        { name: 'warns', description: 'Voir les avertissements d\'un utilisateur', options: [
            { name: 'utilisateur', type: 6, required: true, description: 'L\'utilisateur à consulter' }] },

        { name: 'clear', description: 'Supprimer des messages', options: [
            { name: 'nombre', type: 4, required: true, description: 'Nombre de messages (1-100)' }] },

        { name: 'slowmode', description: 'Définir le slowmode du salon', options: [
            { name: 'secondes', type: 4, required: true, description: 'Délai en secondes' }] },

        { name: 'lock', description: 'Verrouiller le salon actuel' },
        { name: 'unlock', description: 'Déverrouiller le salon actuel' },

        { name: 'setup', description: 'Envoyer les embeds professionnels', options: [
            { name: 'type', type: 3, required: true, description: 'Le type de setup à envoyer', choices: [
                { name: '📜 Règlements', value: 'rules' },
                { name: '🎭 Rôles & Notifs', value: 'roles' },
                { name: '🎫 Support / Tickets', value: 'tickets' },
                { name: '🛡️ Recrutement Staff', value: 'staff' },
                { name: '🚀 TOUT', value: 'all' }] }] },

        { name: 'setup-ticket', description: 'Envoyer le panneau de ticket', options: [
            { name: 'salon', type: 7, required: true, description: 'Le salon où envoyer le panneau', channel_types: [0] }] },

        { name: 'role-menu', description: 'Créer un menu de rôles par boutons', options: [
            { name: 'role1', type: 8, required: true, description: 'Premier rôle (obligatoire)' },
            { name: 'role2', type: 8, required: false, description: 'Deuxième rôle' },
            { name: 'role3', type: 8, required: false, description: 'Troisième rôle' },
            { name: 'role4', type: 8, required: false, description: 'Quatrième rôle' },
            { name: 'role5', type: 8, required: false, description: 'Cinquième rôle' }] },

        { name: 'birthday', description: 'Gérer ton anniversaire', options: [
            { name: 'set', type: 1, description: 'Enregistrer ton anniversaire', options: [
                { name: 'jour', type: 4, required: true, description: 'Jour (1-31)' },
                { name: 'mois', type: 4, required: true, description: 'Mois (1-12)' }] },
            { name: 'remove', type: 1, description: 'Supprimer ton anniversaire' },
            { name: 'list', type: 1, description: 'Voir les anniversaires enregistrés' }] },

        { name: 'translate', description: 'Traduire un texte', options: [
            { name: 'texte', type: 3, required: true, description: 'Le texte à traduire' },
            { name: 'langue_cible', type: 3, required: true, description: 'Langue cible (ex: en, es, fr)' }] }
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ Commandes enregistrées !');
    } catch (e) {
        console.error('❌ Erreur commandes:', e);
    }
}

// ============================================================
// ANTI-RAID : fenêtre glissante de joins
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

// ============================================================
// ANTI-PUB / ANTI-SPAM / ANTI-MENTION
// ============================================================
const userMsgTimes = new Map();
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    const member = message.member;
    if (!member) return;
    const isStaff = member.roles.cache.has(CONFIG.staffRoleId) || member.permissions.has(PermissionFlagsBits.ManageMessages);
    if (isStaff) return;

    let shouldDelete = false;
    let reason = '';
    const content = message.content.toLowerCase();
    const hasLink = /(https?:\/\/|discord\.gg\/|discord\.com\/invite)/i.test(message.content);
    if (hasLink) {
        const allowed = CONFIG.linkWhitelist.some(w => content.includes(w.toLowerCase()));
        if (!allowed) { shouldDelete = true; reason = 'lien non autorisé'; }
    }
    if (message.mentions.users.size >= 4 || message.mentions.roles.size >= 3) {
        shouldDelete = true; reason = 'mass-mention';
    }
    const uid = message.author.id;
    const times = userMsgTimes.get(uid) || [];
    times.push(Date.now());
    const recent = times.filter(t => Date.now() - t < 4000);
    userMsgTimes.set(uid, recent);
    if (recent.length >= 5) { shouldDelete = true; reason = 'spam'; }

    if (shouldDelete) {
        await message.delete().catch(() => {});
        const logCh = message.guild.channels.cache.get(CONFIG.logsChannelId);
        if (logCh) {
            const e = new EmbedBuilder().setColor('#d97706').setTitle('🛡️ Message supprimé (sécurité)')
                .addFields(
                    { name: 'Auteur', value: `${message.author} (\`${uid}\`)`, inline: true },
                    { name: 'Raison', value: reason, inline: true },
                    { name: 'Salon', value: `${message.channel}`, inline: true },
                    { name: 'Contenu', value: (message.content || '*aucun*').substring(0, 1000) })
                .setTimestamp();
            await logCh.send({ embeds: [e] }).catch(() => {});
        }
        if (reason === 'spam' && member.moderatable) {
            await member.timeout(5 * 60 * 1000, 'Anti-spam auto').catch(() => {});
        }
    }
});

// ============================================================
// WELCOME / LEAVE + ANTI-RAID
// ============================================================
client.on(Events.GuildMemberAdd, async (member) => {
    if (checkRaid(member.guild)) {
        const logCh = member.guild.channels.cache.get(CONFIG.logsChannelId);
        if (logCh) {
            const e = new EmbedBuilder().setColor('#dc2626').setTitle('🚨 ALERTE RAID DÉTECTÉE')
                .setDescription('Plusieurs joins rapides détectés. Vérifiez les derniers membres arrivés.').setTimestamp();
            await logCh.send({ content: `<@&${CONFIG.staffRoleId}>`, embeds: [e] }).catch(() => {});
        }
    }
    const channel = member.guild.channels.cache.get(CONFIG.welcomeChannelId);
    if (!channel) return;
    const embed = new EmbedBuilder().setColor('#c9a961').setTitle('🎉 Bienvenue sur Zone Gaming QC !')
        .setDescription(`Salut ${member}, ravi de te compter parmi nous ! 🍁\n\n📜 Lis les règles dans <#${CONFIG.reglementsChannelId}>\n💬 Viens te présenter dans <#${CONFIG.generalChannelId}>\n🎮 Bonne aventure dans la Zone !`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `Membre n°${member.guild.memberCount}` }).setTimestamp();
    await channel.send({ content: `${member}`, embeds: [embed] }).catch(() => {});
});

client.on(Events.GuildMemberRemove, async (member) => {
    const channel = member.guild.channels.cache.get(CONFIG.goodbyeChannelId);
    if (!channel) return;
    const embed = new EmbedBuilder().setColor('#dc2626').setTitle('👋 Départ')
        .setDescription(`${member.user.tag} a quitté le serveur.`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true })).setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => {});
});

// ============================================================
// LOGS : messages supprimés / modifiés
// ============================================================
client.on(Events.MessageDelete, async (message) => {
    if (!message.guild || message.author?.bot) return;
    const logCh = message.guild.channels.cache.get(CONFIG.logsChannelId);
    if (!logCh || message.channel.id === logCh.id) return;
    if (!message.content && !message.attachments.size) return;
    const e = new EmbedBuilder().setColor('#d97706').setTitle('🗑️ Message supprimé')
        .addFields(
            { name: 'Auteur', value: message.author ? `${message.author}` : 'Inconnu', inline: true },
            { name: 'Salon', value: `${message.channel}`, inline: true },
            { name: 'Contenu', value: (message.content || '*pièce jointe*').substring(0, 1000) })
        .setTimestamp();
    await logCh.send({ embeds: [e] }).catch(() => {});
});

client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot) return;
    if (oldMsg.content === newMsg.content) return;
    const logCh = newMsg.guild.channels.cache.get(CONFIG.logsChannelId);
    if (!logCh || newMsg.channel.id === logCh.id) return;
    const e = new EmbedBuilder().setColor('#3498db').setTitle('✏️ Message modifié')
        .addFields(
            { name: 'Auteur', value: `${newMsg.author}`, inline: true },
            { name: 'Salon', value: `${newMsg.channel}`, inline: true },
            { name: 'Avant', value: (oldMsg.content || '*vide*').substring(0, 500) },
            { name: 'Après', value: (newMsg.content || '*vide*').substring(0, 500) })
        .setTimestamp();
    await logCh.send({ embeds: [e] }).catch(() => {});
});

// ============================================================
// ANNIVERSAIRES : vérif toutes les heures
// ============================================================
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
                    if (ch) {
                        const e = new EmbedBuilder().setColor('#c9a961').setTitle('🎂 Joyeux Anniversaire !')
                            .setDescription(`Aujourd'hui c'est l'anniversaire de <@${uid}> ! 🎉\nTous ensemble pour lui souhaiter une excellente journée !`)
                            .setTimestamp();
                        await ch.send({ content: `<@${uid}>`, embeds: [e] }).catch(() => {});
                    }
                }
            }
        }
    }, 60 * 60 * 1000);
}

// ============================================================
// INTERACTIONS
// ============================================================
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        const member = interaction.member;

        // ---------- /SETUP ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels))
                return interaction.reply({ content: '❌ Permission "Gérer les salons" requise.', ephemeral: true });
            const type = interaction.options.getString('type');
            const channel = interaction.channel;
            await interaction.deferReply({ ephemeral: true });
            const site = 'https://jacobin904.github.io/Zone-Gaming-QC/';
            const ico = 'https://cdn.discordapp.com/icons/1531829572453007533/c69bf91096081b8274e81a0a0eefa18e.webp?size=1024';
            try {
                if (type === 'rules' || type === 'all') {
                    await channel.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('📜 Règlements de Zone Gaming QC')
                        .setDescription('En rejoignant ce serveur, vous acceptez les règles suivantes.')
                        .addFields(
                            { name: '1️⃣ Respect & Tolérance', value: 'Insultes, harcèlement, discrimination = BAN IMMÉDIAT.', inline: false },
                            { name: '2️⃣ Langue', value: 'Français principal, pas de SMS excessif.', inline: true },
                            { name: '3️⃣ NSFW', value: 'Strictement interdit.', inline: true },
                            { name: '4️⃣ Spam & Pub', value: 'Interdits sans accord du staff.', inline: true },
                            { name: '5️⃣ Vocal', value: 'Pas de cris / soundboard / musique sans casque.', inline: true },
                            { name: '6️⃣ Staff', value: 'Décisions finales, contestation en privé.', inline: true },
                            { name: '7️⃣ Vie privée', value: 'Pas de doxxing.', inline: true },
                            { name: '8️⃣ Spoilers', value: 'Balise ||spoiler|| obligatoire.', inline: true },
                            { name: '9️⃣ Sanctions', value: '⚠️ Warn ➡️ 🔇 Mute ➡️ 🚪 Kick ️ 🔨 Ban.', inline: false })
                        .setFooter({ text: 'Zone Gaming QC', iconURL: ico }).setTimestamp()] });
                }
                if (type === 'roles' || type === 'all') {
                    await channel.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🎭 Attribution des Rôles')
                        .setDescription('Clique sur les boutons ci-dessous pour personnaliser ton expérience !')
                        .setFooter({ text: 'Zone Gaming QC', iconURL: ico })],
                        components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('role_games').setLabel('🎮 Notifs Jeux').setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder().setCustomId('role_events').setLabel('🎉 Notifs Events').setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder().setCustomId('role_announcements').setLabel('📢 Notifs Annonces').setStyle(ButtonStyle.Secondary))] });
                }
                if (type === 'tickets' || type === 'all') {
                    await channel.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🎫 Centre de Support')
                        .setDescription('Besoin d\'aide ou d\'une modération ? Notre équipe est là.')
                        .addFields({ name: '💡 Conseil', value: 'Décris ton problème en détail pour une réponse rapide.' })
                        .setFooter({ text: `Zone Gaming QC | ${site}`, iconURL: ico })],
                        components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('open_ticket').setLabel('Ouvrir un ticket').setStyle(ButtonStyle.Primary).setEmoji('📩'))] });
                }
                if (type === 'staff' || type === 'all') {
                    await channel.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🛡️ Rejoindre l\'Équipe Staff')
                        .setDescription('Motivé, mature et passionné ? Nous recrutons régulièrement.')
                        .addFields(
                            { name: '✅ Profils recherchés', value: '• Maturité & esprit d\'équipe\n• Disponibilité\n• Envie d\'aider' },
                            { name: '📝 Postuler', value: 'Via notre site web sécurisé.' })
                        .setFooter({ text: `Zone Gaming QC | ${site}`, iconURL: ico })],
                        components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setLabel('Postuler sur le Site Web').setStyle(ButtonStyle.Link)
                                .setURL('https://jacobin904.github.io/Zone-Gaming-QC/Postuler/').setEmoji('🌐'))] });
                }
                await interaction.editReply({ content: `✅ Setup **${type === 'all' ? 'complet' : type}** envoyé !` });
            } catch (e) { console.error('Erreur setup:', e); await interaction.editReply({ content: '❌ Erreur setup.' }); }
        }

        // ---------- /SETUP-TICKET ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup-ticket') {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels))
                return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const t = interaction.options.getChannel('salon');
            await t.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🎫 Système de Support')
                .setDescription('Clique ci-dessous pour ouvrir un ticket.')
                .setFooter({ text: 'Zone Gaming QC' })],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('open_ticket').setLabel('Ouvrir un ticket').setStyle(ButtonStyle.Primary).setEmoji('📩'))] });
            await interaction.reply({ content: `✅ Panneau envoyé dans ${t} !`, ephemeral: true });
        }

        // ---------- /BAN ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'ban') {
            if (!member.permissions.has(PermissionFlagsBits.BanMembers))
                return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const target = interaction.options.getUser('utilisateur');
            const reason = interaction.options.getString('raison') || 'Aucune raison';
            await interaction.guild.members.ban(target, { reason }).catch(() => {});
            const e = new EmbedBuilder().setColor('#dc2626').setTitle('🔨 Bannissement')
                .setDescription(`${target} a été banni.`).addFields({ name: 'Raison', value: reason })
                .setFooter({ text: `Par ${interaction.user.tag}` }).setTimestamp();
            await interaction.reply({ embeds: [e] });
            const lc = interaction.guild.channels.cache.get(CONFIG.logsChannelId);
            if (lc) await lc.send({ embeds: [e] }).catch(() => {});
        }

        // ---------- /KICK ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'kick') {
            if (!member.permissions.has(PermissionFlagsBits.KickMembers))
                return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const target = interaction.options.getMember('utilisateur');
            const reason = interaction.options.getString('raison') || 'Aucune raison';
            if (!target) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
            await target.kick(reason).catch(() => {});
            const e = new EmbedBuilder().setColor('#d97706').setTitle('🚪 Expulsion')
                .setDescription(`${target.user} a été expulsé.`).addFields({ name: 'Raison', value: reason })
                .setFooter({ text: `Par ${interaction.user.tag}` }).setTimestamp();
            await interaction.reply({ embeds: [e] });
            const lc = interaction.guild.channels.cache.get(CONFIG.logsChannelId);
            if (lc) await lc.send({ embeds: [e] }).catch(() => {});
        }

        // ---------- /MUTE ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'mute') {
            if (!member.permissions.has(PermissionFlagsBits.ModerateMembers))
                return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const target = interaction.options.getMember('utilisateur');
            const mins = interaction.options.getInteger('duree_minutes');
            const reason = interaction.options.getString('raison') || 'Aucune raison';
            if (!target || !target.moderatable) return interaction.reply({ content: '❌ Impossible de mute ce membre.', ephemeral: true });
            await target.timeout(mins * 60 * 1000, reason).catch(() => {});
            const e = new EmbedBuilder().setColor('#d97706').setTitle('🔇 Timeout')
                .setDescription(`${target.user} mis en timeout ${mins} min.`).addFields({ name: 'Raison', value: reason })
                .setFooter({ text: `Par ${interaction.user.tag}` }).setTimestamp();
            await interaction.reply({ embeds: [e] });
            const lc = interaction.guild.channels.cache.get(CONFIG.logsChannelId);
            if (lc) await lc.send({ embeds: [e] }).catch(() => {});
        }

        // ---------- /UNMUTE ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'unmute') {
            if (!member.permissions.has(PermissionFlagsBits.ModerateMembers))
                return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const target = interaction.options.getMember('utilisateur');
            if (!target) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
            await target.timeout(null).catch(() => {});
            await interaction.reply({ embeds: [new EmbedBuilder().setColor('#059669').setTitle('🔊 Timeout retiré').setDescription(`${target.user} peut à nouveau parler.`).setTimestamp()] });
        }

        // ---------- /WARN ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'warn') {
            if (!member.roles.cache.has(CONFIG.staffRoleId) && !member.permissions.has(PermissionFlagsBits.ModerateMembers))
                return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const target = interaction.options.getUser('utilisateur');
            const reason = interaction.options.getString('raison');
            const data = await loadTable(interaction.guild, 'warns');
            if (!data[target.id]) data[target.id] = [];
            data[target.id].push({ by: interaction.user.id, reason, date: new Date().toISOString() });
            await saveTable(interaction.guild, 'warns', data);
            const e = new EmbedBuilder().setColor('#d97706').setTitle('⚠️ Avertissement')
                .setDescription(`${target} a reçu un warn.`)
                .addFields({ name: 'Raison', value: reason }, { name: 'Total', value: `${data[target.id].length} warn(s)` })
                .setFooter({ text: `Par ${interaction.user.tag}` }).setTimestamp();
            await interaction.reply({ embeds: [e] });
            const lc = interaction.guild.channels.cache.get(CONFIG.logsChannelId);
            if (lc) await lc.send({ embeds: [e] }).catch(() => {});
            if (data[target.id].length >= 3) {
                const m = await interaction.guild.members.fetch(target.id).catch(() => null);
                if (m && m.moderatable) await m.timeout(10 * 60 * 1000, 'Auto: 3 warns').catch(() => {});
            }
        }

        // ---------- /WARNS ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'warns') {
            const target = interaction.options.getUser('utilisateur');
            const data = await loadTable(interaction.guild, 'warns');
            const list = data[target.id] || [];
            if (!list.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor('#059669').setTitle('✅ Aucun warn').setDescription(`${target} n'a aucun avertissement.`)] });
            const fields = list.slice(-10).map((w, i) => ({ name: `Warn #${i + 1}`, value: `${w.reason}\n*par <@${w.by}> le ${new Date(w.date).toLocaleDateString()}*`, inline: false }));
            await interaction.reply({ embeds: [new EmbedBuilder().setColor('#d97706').setTitle(`⚠️ Warns de ${target.tag}`).addFields(fields).setTimestamp()] });
        }

        // ---------- /CLEAR ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'clear') {
            if (!member.permissions.has(PermissionFlagsBits.ManageMessages))
                return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const n = interaction.options.getInteger('nombre');
            if (n < 1 || n > 100) return interaction.reply({ content: '❌ Entre 1 et 100.', ephemeral: true });
            const deleted = await interaction.channel.bulkDelete(n, true).catch(() => []);
            await interaction.reply({ content: `🗑️ ${deleted.size} message(s) supprimé(s).`, ephemeral: true });
        }

        // ---------- /SLOWMODE ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'slowmode') {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels))
                return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const s = interaction.options.getInteger('secondes');
            await interaction.channel.setRateLimitPerUser(s).catch(() => {});
            await interaction.reply({ content: `⏱️ Slowmode défini à ${s}s.`, ephemeral: true });
        }

        // ---------- /LOCK / /UNLOCK ----------
        if (interaction.isChatInputCommand() && (interaction.commandName === 'lock' || interaction.commandName === 'unlock')) {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels))
                return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const lock = interaction.commandName === 'lock';
            await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: !lock }).catch(() => {});
            await interaction.reply({ content: lock ? '🔒 Salon verrouillé.' : '🔓 Salon déverrouillé.', ephemeral: true });
        }

        // ---------- /ROLE-MENU ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'role-menu') {
            if (!member.permissions.has(PermissionFlagsBits.ManageRoles))
                return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const roles = [1, 2, 3, 4, 5].map(i => interaction.options.getRole(`role${i}`)).filter(Boolean);
            const buttons = roles.map(r => new ButtonBuilder().setCustomId(`roletoggle_${r.id}`).setLabel(r.name).setStyle(ButtonStyle.Secondary));
            const rows = [];
            for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
            const desc = roles.map(r => `• ${r}`).join('\n');
            await interaction.channel.send({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🎭 Choisis tes rôles')
                .setDescription(`Clique sur les boutons pour activer/désactiver un rôle :\n\n${desc}`)
                .setFooter({ text: 'Zone Gaming QC' })], components: rows });
            await interaction.reply({ content: '✅ Menu de rôles envoyé !', ephemeral: true });
        }

        // ---------- /BIRTHDAY ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'birthday') {
            const sub = interaction.options.getSubcommand();
            if (sub === 'set') {
                const d = interaction.options.getInteger('jour');
                const m = interaction.options.getInteger('mois');
                if (d < 1 || d > 31 || m < 1 || m > 12) return interaction.reply({ content: '❌ Date invalide.', ephemeral: true });
                const data = await loadTable(interaction.guild, 'birthdays');
                data[interaction.user.id] = { day: d, month: m };
                await saveTable(interaction.guild, 'birthdays', data);
                await interaction.reply({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🎂 Anniversaire enregistré')
                    .setDescription(`Ton anniversaire est maintenant le **${d}/${m}**. On te fêtera ça !`)] });
            } else if (sub === 'remove') {
                const data = await loadTable(interaction.guild, 'birthdays');
                delete data[interaction.user.id];
                await saveTable(interaction.guild, 'birthdays', data);
                await interaction.reply({ content: '🗑️ Anniversaire supprimé.', ephemeral: true });
            } else if (sub === 'list') {
                const data = await loadTable(interaction.guild, 'birthdays');
                const entries = Object.entries(data);
                if (!entries.length) return interaction.reply({ content: 'Aucun anniversaire enregistré.', ephemeral: true });
                const desc = entries.map(([uid, b]) => `• <@${uid}> — ${b.day}/${b.month}`).join('\n');
                await interaction.reply({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle('🎂 Anniversaires').setDescription(desc.substring(0, 4000))] });
            }
        }

        // ---------- /TRANSLATE ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'translate') {
            const text = interaction.options.getString('texte');
            const lang = interaction.options.getString('langue_cible').toLowerCase();
            await interaction.deferReply();
            try {
                const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${lang}`);
                const j = await r.json();
                const tr = j?.responseData?.translatedText || 'Traduction indisponible.';
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle(`🌐 Traduction (${lang})`)
                    .addFields({ name: 'Original', value: text.substring(0, 1000) }, { name: 'Traduit', value: tr.substring(0, 1000) })] });
            } catch (e) { await interaction.editReply({ content: '❌ Erreur de traduction.' }); }
        }

        // ---------- BOUTON : TOGGLE RÔLE ----------
        if (interaction.isButton() && interaction.customId.startsWith('roletoggle_')) {
            const roleId = interaction.customId.replace('roletoggle_', '');
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return interaction.reply({ content: '❌ Rôle introuvable.', ephemeral: true });
            const m = interaction.member;
            if (m.roles.cache.has(roleId)) { await m.roles.remove(role).catch(() => {}); await interaction.reply({ content: `➖ Rôle **${role.name}** retiré.`, ephemeral: true }); }
            else { await m.roles.add(role).catch(() => {}); await interaction.reply({ content: `➕ Rôle **${role.name}** ajouté.`, ephemeral: true }); }
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
            await tc.send({ content: `${member}`, embeds: [new EmbedBuilder().setColor('#c9a961').setTitle(`🎫 Ticket de ${member.user.username}`)
                .setDescription('Décris ton problème, l\'équipe arrive.').setFooter({ text: 'Zone Gaming QC' })],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Fermer le ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'))] });
            await interaction.reply({ content: `✅ Ticket créé : ${tc}`, ephemeral: true });
        }

        // ---------- BOUTON : FERMER TICKET ----------
        if (interaction.isButton() && interaction.customId === 'close_ticket') {
            await interaction.channel.send('🔒 Fermeture dans 5s...');
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            await interaction.reply({ content: '✅ Fermeture...', ephemeral: true });
        }

        // ---------- BOUTONS CANDIDATURE ----------
        if (interaction.isButton() && (interaction.customId.startsWith('approve_staff_') || interaction.customId.startsWith('deny_staff_'))) {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            const ok = interaction.customId.startsWith('approve_staff_');
            const cid = interaction.customId.split('_')[2];
            const modal = new ModalBuilder().setCustomId(`response_modal_${ok ? 'approve' : 'deny'}_${cid}`)
                .setTitle(ok ? '✅ Approuver' : '❌ Refuser');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Raison / Commentaire').setStyle(TextInputStyle.Paragraph).setRequired(true)));
            await interaction.showModal(modal);
        }

        // ---------- MODAL RÉPONSE ----------
        if (interaction.isModalSubmit() && interaction.customId.startsWith('response_modal_')) {
            const p = interaction.customId.split('_');
            const action = p[2], cid = p[3], reason = interaction.fields.getTextInputValue('reason');
            const color = action === 'approve' ? 0x059669 : 0xdc2626;
            const e = new EmbedBuilder().setColor(color).setTitle(action === 'approve' ? 'Candidature Approuvée !' : 'Candidature Refusée')
                .setDescription('Ta candidature staff a été traitée.')
                .addFields(
                    { name: 'Décision', value: action === 'approve' ? '✅ Acceptée' : '❌ Refusée', inline: true },
                    { name: 'Par', value: `${interaction.user}`, inline: true },
                    { name: 'Raison', value: reason }).setTimestamp();
            await fetch(process.env.WEBHOOK_REPONSE, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: `<@${cid}>`, embeds: [e.toJSON()] }) }).catch(() => {});
            await interaction.reply({ content: '✅ Réponse envoyée.', ephemeral: true });
        }

    } catch (error) {
        console.error('Erreur interaction:', error);
        if (!interaction.replied && !interaction.deferred)
            await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true }).catch(() => {});
    }
});

process.on('unhandledRejection', e => console.error('Rejet:', e));
process.on('uncaughtException', e => console.error('Exception:', e));

client.login(process.env.TOKEN);
