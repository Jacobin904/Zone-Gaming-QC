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
    unverifiedRoleId: '1532905582175191120',
    memberRoleId: '1531832874599448666',
    logoUrl: 'https://cdn.discordapp.com/icons/1531829572453007533/c69bf91096081b8274e81a0a0eefa18e.webp?size=1024'
};

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

async function sendLog(guild, title, fields, color = '#c9a961', eventId = null) {
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
                    ).setFooter({ text: 'Zone Gaming QC', iconURL: CONFIG.logoUrl }).setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`approve_${data.discordId}`).setLabel('Approuver').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId(`deny_${data.discordId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger).setEmoji('')
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
});

async function registerCommands() {
    const commands = [
        { name: 'sanction', description: 'Appliquer une sanction à un membre', options: [
            { name: 'type', type: 3, required: true, description: 'Type de sanction', choices: [
                { name: '🔨 Ban', value: 'ban' }, { name: '🚪 Kick', value: 'kick' },
                { name: '🔇 Mute', value: 'mute' }, { name: '🔊 Unmute', value: 'unmute' },
                { name: '⚠️ Warn', value: 'warn' }] },
            { name: 'utilisateur', type: 6, required: true, description: 'Le membre à sanctionner' },
            { name: 'raison', type: 3, required: true, description: 'La raison de la sanction' },
            { name: 'duree_minutes', type: 4, required: false, description: 'Durée (uniquement pour mute)' }] },
        { name: 'annonce', description: 'Créer une annonce professionnelle avec IA intégrée', options: [
            { name: 'sujet', type: 3, required: true, description: 'Le sujet de l\'annonce (ex: nouveau jeu, événement, mise à jour)' },
            { name: 'type', type: 3, required: true, description: 'Type d\'annonce', choices: [
                { name: '📢 Public (tout le serveur)', value: 'public' },
                { name: '🔒 Staff uniquement', value: 'staff' }] },
            { name: 'details', type: 3, required: false, description: 'Détails supplémentaires (optionnel)' }] },
        { name: 'sondage', description: 'Créer un sondage interactif', options: [
            { name: 'question', type: 3, required: true, description: 'La question du sondage' },
            { name: 'option1', type: 3, required: true, description: 'Première option' },
            { name: 'option2', type: 3, required: true, description: 'Deuxième option' },
            { name: 'option3', type: 3, required: false, description: 'Troisième option' },
            { name: 'option4', type: 3, required: false, description: 'Quatrième option' },
            { name: 'option5', type: 3, required: false, description: 'Cinquième option' },
            { name: 'option6', type: 3, required: false, description: 'Sixième option' }] },
        { name: 'setup', description: 'Envoyer TOUS les embeds de configuration du serveur' },
        { name: 'setup-verify', description: 'Envoyer le panneau de vérification humaine' },
        { name: 'clear', description: 'Supprimer des messages', options: [
            { name: 'nombre', type: 4, required: true, description: 'Nombre de messages (1-100)' }] },
        { name: 'lock', description: 'Verrouiller le salon' },
        { name: 'unlock', description: 'Déverrouiller le salon' },
        { name: 'translate', description: 'Traduire un texte', options: [
            { name: 'texte', type: 3, required: true, description: 'Le texte à traduire' },
            { name: 'langue', type: 3, required: true, description: 'Langue cible (ex: en, es, it)' }] }
    ];
    try { await client.application.commands.set(commands); console.log('✅ Commandes enregistrées !'); }
    catch (e) { console.error('❌ Erreur commandes:', e); }
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
    ], '#d97706', `del_${message.id}`);
});

client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot) return;
    if (oldMsg.content === newMsg.content && oldMsg.embeds.length === newMsg.embeds.length) return;
    sendLog(newMsg.guild, 'Message Modifié', [
        { name: 'Auteur', value: `${newMsg.author.tag} (\`${newMsg.author.id}\`)`, inline: true },
        { name: 'Salon', value: `${newMsg.channel}`, inline: true },
        { name: 'Avant', value: (oldMsg.content || '*vide*').substring(0, 500) },
        { name: 'Après', value: (newMsg.content || '*vide*').substring(0, 500) }
    ], '#3498db', `upd_${newMsg.id}`);
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
    ], '#dc2626', `ban_${ban.user.id}`);
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
    ], '#dc2626', `chan_del_${channel.id}`);
});

// ============================================================
// INTERACTIONS & COMMANDES
// ============================================================
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        const member = interaction.member;

        // ---------- /SANCTION (Unifiée) ----------
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
                ], '#dc2626', `sanction_ban_${target.id}`);
            } else if (type === 'kick') {
                const targetMember = interaction.options.getMember('utilisateur');
                if (!targetMember) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
                await targetMember.kick(reason).catch(() => {});
                await interaction.reply({ content: `🚪 ${targetMember.user.tag} a été expulsé.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Kick', [
                    { name: 'Cible', value: `${targetMember.user.tag} (\`${targetMember.id}\`)`, inline: true },
                    { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Raison', value: reason }
                ], '#d97706', `sanction_kick_${targetMember.id}`);
            } else if (type === 'mute') {
                const targetMember = interaction.options.getMember('utilisateur');
                if (!targetMember || !targetMember.moderatable) return interaction.reply({ content: '❌ Impossible de mute ce membre.', ephemeral: true });
                if (!duration) return interaction.reply({ content: '❌ Durée requise pour un mute.', ephemeral: true });
                await targetMember.timeout(duration * 60 * 1000, reason).catch(() => {});
                await interaction.reply({ content: `🔇 ${targetMember.user.tag} mis en timeout ${duration} min.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Mute', [
                    { name: 'Cible', value: `${targetMember.user.tag} (\`${targetMember.id}\`)`, inline: true },
                    { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Durée', value: `${duration} minutes` },
                    { name: 'Raison', value: reason }
                ], '#d97706', `sanction_mute_${targetMember.id}`);
            } else if (type === 'unmute') {
                const targetMember = interaction.options.getMember('utilisateur');
                if (!targetMember) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
                await targetMember.timeout(null).catch(() => {});
                await interaction.reply({ content: `🔊 Timeout retiré pour ${targetMember.user.tag}.`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Unmute', [
                    { name: 'Cible', value: `${targetMember.user.tag} (\`${targetMember.id}\`)`, inline: true },
                    { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true }
                ], '#059669', `sanction_unmute_${targetMember.id}`);
            } else if (type === 'warn') {
                await interaction.reply({ content: `⚠️ ${target.tag} a reçu un avertissement pour : ${reason}`, ephemeral: true });
                sendLog(interaction.guild, 'Sanction: Warn', [
                    { name: 'Cible', value: `${target.tag} (\`${target.id}\`)`, inline: true },
                    { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Raison', value: reason }
                ], '#d97706', `sanction_warn_${target.id}`);
            }
        }

        // ---------- /ANNONCE (Avec IA intégrée) ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'annonce') {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
            
            const sujet = interaction.options.getString('sujet');
            const type = interaction.options.getString('type');
            const details = interaction.options.getString('details') || '';
            
            await interaction.deferReply({ ephemeral: true });
            
            // Système de templates IA pour générer des annonces professionnelles
            const templates = {
                'événement': {
                    title: '🎉 Événement Spécial à Venir !',
                    body: `Chers membres de Zone Gaming QC,\n\nNous avons le plaisir de vous annoncer un **événement spécial** centré sur **${sujet}** !\n\n${details ? `**Détails de l'événement :**\n${details}\n\n` : ''}Restez à l'affût pour plus d'informations dans les prochains jours. L'équipe prépare quelque chose de mémorable pour vous !\n\n **Zone Gaming QC** - Votre communauté gaming québécoise`,
                    color: '#c9a961'
                },
                'mise à jour': {
                    title: '🔄 Mise à Jour Importante',
                    body: `Bonjour à tous,\n\nUne **mise à jour** concernant **${sujet}** a été déployée sur le serveur.\n\n${details ? `**Changements apportés :**\n${details}\n\n` : ''}Merci de prendre connaissance de ces modifications. En cas de question, n'hésitez pas à ouvrir un ticket.\n\n🍁 **L'équipe Zone Gaming QC**`,
                    color: '#3498db'
                },
                'nouveau': {
                    title: '✨ Nouvelle Fonctionnalité Disponible !',
                    body: `Salut la communauté !\n\nNous sommes ravis de vous présenter **${sujet}** sur Zone Gaming QC !\n\n${details ? `**Ce que cela apporte :**\n${details}\n\n` : ''}Venez découvrir cette nouvelle fonctionnalité et donnez-nous votre feedback !\n\n🍁 **Zone Gaming QC** - Toujours en évolution`,
                    color: '#059669'
                },
                'rappel': {
                    title: '📌 Rappel Important',
                    body: `Chers membres,\n\nCe message est un **rappel** concernant **${sujet}**.\n\n${details ? `**Points à retenir :**\n${details}\n\n` : ''}Merci de votre coopération pour maintenir une communauté saine et respectueuse.\n\n🍁 **L'équipe Zone Gaming QC**`,
                    color: '#d97706'
                },
                'default': {
                    title: `📢 Annonce : ${sujet}`,
                    body: `Bonjour à tous,\n\nL'équipe de Zone Gaming QC souhaite porter à votre attention les informations suivantes concernant **${sujet}**.\n\n${details ? `**Détails :**\n${details}\n\n` : ''}Merci de votre attention et bonne continuation sur le serveur !\n\n **Zone Gaming QC** - Communauté Gaming Québécoise`,
                    color: '#c9a961'
                }
            };
            
            // Détection automatique du type d'annonce
            const sujetLower = sujet.toLowerCase();
            let template = templates.default;
            if (sujetLower.includes('event') || sujetLower.includes('tournoi') || sujetLower.includes('soirée')) template = templates['événement'];
            else if (sujetLower.includes('update') || sujetLower.includes('maj') || sujetLower.includes('changement')) template = templates['mise à jour'];
            else if (sujetLower.includes('nouveau') || sujetLower.includes('ajout') || sujetLower.includes('feature')) template = templates['nouveau'];
            else if (sujetLower.includes('rappel') || sujetLower.includes('attention') || sujetLower.includes('important')) template = templates['rappel'];
            
            const embed = new EmbedBuilder()
                .setColor(template.color)
                .setTitle(template.title)
                .setDescription(template.body)
                .setFooter({ text: 'Zone Gaming QC • Annonce Officielle', iconURL: CONFIG.logoUrl })
                .setTimestamp();
            
            if (type === 'public') {
                const channel = interaction.guild.channels.cache.get(CONFIG.generalChannelId);
                if (channel) {
                    await channel.send({ content: null, embeds: [embed] });
                    await interaction.editReply({ content: '✅ Annonce publique envoyée dans le salon général !' });
                } else {
                    await interaction.editReply({ content: '❌ Salon général introuvable.' });
                }
            } else {
                const channel = interaction.guild.channels.cache.find(c => c.name === 'annonce-staff' || c.name === 'discussion-staff');
                if (channel) {
                    await channel.send({ content: null, embeds: [embed] });
                    await interaction.editReply({ content: '✅ Annonce staff envoyée !' });
                } else {
                    await interaction.editReply({ content: ' Salon staff introuvable.' });
                }
            }
        }

        // ---------- /SONDAGE ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'sondage') {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
            
            const question = interaction.options.getString('question');
            const options = [];
            for (let i = 1; i <= 6; i++) {
                const opt = interaction.options.getString(`option${i}`);
                if (opt) options.push(opt);
            }
            
            if (options.length < 2) return interaction.reply({ content: '❌ Au moins 2 options requises.', ephemeral: true });
            
            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️'];
            const optionsText = options.map((opt, i) => `${emojis[i]} **${opt}**`).join('\n');
            
            const embed = new EmbedBuilder()
                .setColor('#c9a961')
                .setTitle('📊 Sondage Zone Gaming QC')
                .setDescription(`**${question}**\n\n${optionsText}\n\n*Réagissez avec l'emoji correspondant à votre choix !*`)
                .setFooter({ text: 'Zone Gaming QC • Sondage Officiel', iconURL: CONFIG.logoUrl })
                .setTimestamp();
            
            const msg = await interaction.channel.send({ content: null, embeds: [embed] });
            
            // Ajouter les réactions
            for (let i = 0; i < options.length; i++) {
                await msg.react(emojis[i]).catch(() => {});
            }
            
            await interaction.reply({ content: '✅ Sondage créé avec succès !', ephemeral: true });
        }

        // ---------- /SETUP (Tout en un) ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const channel = interaction.channel;
            const site = 'https://jacobin904.github.io/Zone-Gaming-QC/';
            
            // 1. RÈGLEMENTS ULTRA-PROFESSIONNEL
            const reglementsEmbed = new EmbedBuilder()
                .setColor('#c9a961')
                .setTitle('📜 RÈGLEMENT OFFICIEL - ZONE GAMING QC')
                .setDescription('**Dernière mise à jour :** Août 2026\n**Version :** 2.0\n\nEn rejoignant Zone Gaming QC, vous acceptez pleinement et sans réserve l\'ensemble des règles ci-dessous. Leur méconnaissance n\'est pas une excuse valable.')
                .addFields(
                    { name: '━━━━━━━━━━━━━━━━━━━━━━━', value: '🏛️ **SECTION 1 : COMPORTEMENT GÉNÉRAL**', inline: false },
                    { name: '1.1 - Respect & Tolérance (TOLÉRANCE ZÉRO)', value: 'Toute forme d\'insulte, de harcèlement, de racisme, de sexisme, d\'homophobie ou de discrimination sera sanctionnée d\'un **BAN DÉFINITIF IMMÉDIAT**, sans avertissement préalable. Nous prônons une communauté inclusive et bienveillante.', inline: false },
                    { name: '1.2 - Langue & Communication', value: 'Le **français** est la langue officielle du serveur. L\'anglais est toléré dans les salons de jeux internationaux, mais doit rester minoritaire. Évitez le langage SMS excessif et privilégiez une communication claire.', inline: false },
                    { name: '1.3 - Contenu NSFW (STRICTEMENT INTERDIT)', value: 'Tout contenu à caractère sexuel, violent, gore, ou choquant sous quelque forme que ce soit (images, vidéos, liens, pseudos, avatars) est formellement prohibé. Sanction : **BAN DÉFINITIF**.', inline: false },
                    { name: '━━━━━━━━━━━━━━━━━━━━━━━', value: '️ **SECTION 2 : SÉCURITÉ & MODÉRATION**', inline: false },
                    { name: '2.1 - Spam & Publicité', value: 'Le flood de messages, le spam d\'emojis, et la publicité pour d\'autres serveurs/produits sans accord écrit de la direction sont interdits. Sanction progressive : Warn → Mute → Kick → Ban.', inline: false },
                    { name: '2.2 - Vie Privée & Doxxing', value: 'Il est strictement interdit de partager ses propres informations personnelles (adresse, téléphone, etc.) ainsi que celles d\'autres membres. Le doxxing entraîne un **BAN DÉFINITIF** et un signalement aux autorités si nécessaire.', inline: false },
                    { name: '2.3 - Spoilers', value: 'Utilisez obligatoirement la balise `||spoiler||` pour toute mention de sorties récentes de jeux, films, séries ou événements. Un avertissement sera donné en cas de manquement.', inline: false },
                    { name: '━━━━━━━━━━━━━━━━━━━━━━━', value: '🎙️ **SECTION 3 : SALONS VOCAUX**', inline: false },
                    { name: '3.1 - Respect en Vocal', value: 'Pas de cris, de soundboards, de musique forte sans casque, ou de tout autre comportement perturbateur. Le non-respect entraînera un mute temporaire puis un kick du salon.', inline: false },
                    { name: '3.2 - Enregistrement', value: 'Il est interdit d\'enregistrer ou de diffuser des conversations vocales sans le consentement explicite de tous les participants.', inline: false },
                    { name: '━━━━━━━━━━━━━━━━━━━━━━━', value: '⚖️ **SECTION 4 : ÉCHELLE DES SANCTIONS**', inline: false },
                    { name: '4.1 - Progression des Sanctions', value: '⚠️ **1er Avertissement** → Rappel à l\'ordre\n🔇 **2ème Avertissement** → Mute 10 minutes\n🚪 **3ème Avertissement** → Kick du serveur\n🔨 **4ème Avertissement** → Ban temporaire (7 jours)\n💀 **5ème Avertissement** → **BAN DÉFINITIF**\n\n*Note : Certaines infractions graves (racisme, doxxing, NSFW) contournent cette échelle et entraînent un ban immédiat.*', inline: false },
                    { name: '4.2 - Contestation', value: 'Toute contestation d\'une sanction doit se faire **uniquement** via le système de tickets. Les contestations publiques seront ignorées et pourront aggraver la situation.', inline: false },
                    { name: '━━━━━━━━━━━━━━━━━━━━━━━', value: ' **SECTION 5 : CONTACT & SUPPORT**', inline: false },
                    { name: '5.1 - Autorité du Staff', value: 'Les décisions de l\'équipe de modération sont **finales et souveraines**. Toute tentative de contournement, d\'insubordination ou de manipulation sera sanctionnée.', inline: false },
                    { name: '5.2 - Signalement', value: 'Pour signaler un problème, utilisez le système de tickets ou contactez un membre du staff en privé. Ne faites pas justice vous-même.', inline: false }
                )
                .setFooter({ text: 'Zone Gaming QC • Règlement v2.0 • Août 2026', iconURL: CONFIG.logoUrl })
                .setTimestamp();
            
            // 2. CONDITIONS DE PARTENARIAT
            const partenariatEmbed = new EmbedBuilder()
                .setColor('#c9a961')
                .setTitle('🤝 CONDITIONS DE PARTENARIAT - ZONE GAMING QC')
                .setDescription('Zone Gaming QC est ouvert aux partenariats avec des serveurs et projets de qualité. Voici nos conditions et critères de sélection.')
                .addFields(
                    { name: '━━━━━━━━━━━━━━━━━━━━━━━', value: '✅ **CRITÈRES D\'ÉLIGIBILITÉ**', inline: false },
                    { name: '1. Communauté Francophone', value: 'Votre serveur doit être principalement francophone (minimum 80% de contenu en français).', inline: false },
                    { name: '2. Taille Minimale', value: 'Votre serveur doit compter au moins **100 membres** dont **30 membres actifs** quotidiennement.', inline: false },
                    { name: '3. Contenu Sain', value: 'Votre serveur ne doit pas contenir de contenu NSFW, illégal, ou contraire à nos valeurs (racisme, discrimination, etc.).', inline: false },
                    { name: '4. Activité Régulière', value: 'Votre serveur doit être actif avec des événements réguliers et une modération présente.', inline: false },
                    { name: '━━━━━━━━━━━━━━━━━━━━━━━', value: ' **CONDITIONS DU PARTENARIAT**', inline: false },
                    { name: '1. Échange de Visibilité', value: 'Vous devez afficher notre serveur dans votre salon de partenariats avec notre description et lien d\'invitation.', inline: false },
                    { name: '2. Durée Minimale', value: 'Le partenariat est établi pour une durée minimale de **30 jours**. Passé ce délai, il peut être renouvelé ou résilié par l\'une des parties.', inline: false },
                    { name: '3. Non-Concurrence', value: 'Votre serveur ne doit pas être en concurrence directe avec Zone Gaming QC (même thème, même public cible).', inline: false },
                    { name: '4. Respect Mutuel', value: 'Les membres de votre serveur doivent respecter notre règlement lorsqu\'ils nous visitent, et vice-versa.', inline: false },
                    { name: '━━━━━━━━━━━━━━━━━━━━━━━', value: '📝 **COMMENT POSTULER ?**', inline: false },
                    { name: 'Procédure de Demande', value: '1. Assurez-vous de remplir tous les critères ci-dessus.\n2. Ouvrez un ticket sur notre serveur avec le sujet "Demande de Partenariat".\n3. Fournissez les informations suivantes :\n   • Nom et lien de votre serveur\n   • Nombre de membres et activité quotidienne\n   • Description de votre communauté\n   • Ce que vous pouvez nous apporter\n4. Notre équipe étudiera votre demande sous 48-72h.', inline: false },
                    { name: '️ **IMPORTANT**', value: 'Une fausse déclaration dans votre demande entraînera un refus immédiat et un bannissement de notre serveur. Les partenariats sont renouvelables mensuellement selon la qualité de la collaboration.', inline: false }
                )
                .setFooter({ text: 'Zone Gaming QC • Partenariats • Août 2026', iconURL: CONFIG.logoUrl })
                .setTimestamp();
            
            // 3. RÔLES
            const rolesEmbed = new EmbedBuilder()
                .setColor('#c9a961')
                .setTitle('🎭 ATTRIBUTION DES RÔLES')
                .setDescription('Personnalisez votre expérience sur Zone Gaming QC en cliquant sur les boutons ci-dessous pour recevoir les notifications qui vous intéressent.')
                .addFields(
                    { name: ' Rôles de Notification', value: '• **Notifs Jeux** : Soyez alerté des sessions de jeu organisées\n• **Notifs Events** : Ne manquez aucun événement spécial\n• **Notifs Annonces** : Recevez toutes les annonces importantes', inline: false }
                )
                .setFooter({ text: 'Zone Gaming QC • Rôles', iconURL: CONFIG.logoUrl });
            
            // 4. TICKETS
            const ticketsEmbed = new EmbedBuilder()
                .setColor('#c9a961')
                .setTitle('🎫 CENTRE DE SUPPORT')
                .setDescription('Besoin d\'aide, d\'une modération, ou d\'une réponse rapide de l\'équipe ? Notre système de tickets est à votre disposition.')
                .addFields(
                    { name: '💡 Comment ça marche ?', value: '1. Cliquez sur le bouton ci-dessous\n2. Un salon privé sera créé pour vous et le staff\n3. Décrivez votre problème en détail\n4. Un membre du staff vous répondra rapidement', inline: false },
                    { name: '⚠️ Règles des Tickets', value: '• Soyez patient, un staff arrive\n• Décrivez votre problème clairement\n• Ne fermez pas sans raison valable\n• Toute insulte = avertissement', inline: false }
                )
                .setFooter({ text: `Zone Gaming QC • Site: ${site}`, iconURL: CONFIG.logoUrl });
            
            // 5. STAFF
            const staffEmbed = new EmbedBuilder()
                .setColor('#c9a961')
                .setTitle('🛡️ REJOINDRE L\'ÉQUIPE STAFF')
                .setDescription('Tu es motivé, mature et passionné par l\'animation de communauté ? Nous cherchons régulièrement de nouveaux talents pour renforcer notre équipe.')
                .addFields(
                    { name: '✅ Ce que nous recherchons', value: '• Maturité et esprit d\'équipe irréprochables\n• Disponibilité régulière (minimum 10h/semaine)\n• Envie réelle d\'aider et de faire grandir la communauté\n• Expérience en modération (atout, pas obligatoire)', inline: false },
                    { name: ' Comment postuler ?', value: 'Le processus est 100% sécurisé et se fait via notre site web officiel. Cliquez sur le bouton ci-dessous pour accéder au formulaire de candidature.', inline: false },
                    { name: '️ Délai de Réponse', value: 'Nous étudions toutes les candidatures sous 7 jours. Seuls les candidats retenus seront contactés.', inline: false }
                )
                .setFooter({ text: `Zone Gaming QC • Site: ${site}`, iconURL: CONFIG.logoUrl });
            
            // Envoi de tous les embeds
            await channel.send({ content: null, embeds: [reglementsEmbed] });
            await channel.send({ content: null, embeds: [partenariatEmbed] });
            await channel.send({ content: null, embeds: [rolesEmbed], components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('role_games').setLabel(' Notifs Jeux').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('role_events').setLabel('🎉 Notifs Events').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('role_announcements').setLabel(' Notifs Annonces').setStyle(ButtonStyle.Secondary)
            )] });
            await channel.send({ content: null, embeds: [ticketsEmbed], components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('open_ticket').setLabel('Ouvrir un ticket').setStyle(ButtonStyle.Primary).setEmoji('📩')
            )] });
            await channel.send({ content: null, embeds: [staffEmbed], components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Postuler sur le Site Web').setStyle(ButtonStyle.Link).setURL('https://jacobin904.github.io/Zone-Gaming-QC/Postuler/').setEmoji('🌐')
            )] });
            
            await interaction.editReply({ content: '✅ Setup complet envoyé ! Tous les embeds ont été publiés.' });
        }

        // ---------- /SETUP-VERIFY ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup-verify') {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const embed = new EmbedBuilder()
                .setColor('#059669')
                .setTitle('🛡️ Vérification de Sécurité Humaine')
                .setDescription('Bienvenue sur **Zone Gaming QC** !\n\nPour accéder à l\'ensemble du serveur et protéger notre communauté contre les raids et les bots, une vérification simple est requise.\n\n👇 **Clique sur le bouton ci-dessous** pour obtenir ton rôle de membre.')
                .setFooter({ text: 'Zone Gaming QC • Sécurité', iconURL: CONFIG.logoUrl })
                .setTimestamp();
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verify_human').setLabel('Je suis humain').setStyle(ButtonStyle.Success).setEmoji('✅')
            );
            await interaction.channel.send({ content: null, embeds: [embed], components: [row] });
            await interaction.reply({ content: '✅ Panneau de vérification envoyé !', ephemeral: true });
        }

        // ---------- BOUTON VÉRIFICATION ----------
        if (interaction.isButton() && interaction.customId === 'verify_human') {
            if (member.roles.cache.has(CONFIG.unverifiedRoleId)) {
                await member.roles.remove(CONFIG.unverifiedRoleId);
                await member.roles.add(CONFIG.memberRoleId);
                await interaction.reply({ content: '✅ Vérification réussie !', ephemeral: true });
                sendLog(interaction.guild, 'Utilisateur Vérifié', [
                    { name: 'Utilisateur', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                    { name: 'Action', value: 'Rôle "Non vérifié" → "Membre"', inline: false }
                ], '#059669', `verify_${member.id}`);
            } else if (member.roles.cache.has(CONFIG.memberRoleId)) {
                await interaction.reply({ content: 'ℹ️ Déjà vérifié !', ephemeral: true });
            } else {
                await interaction.reply({ content: '❌ Erreur : Rôle "Non vérifié" manquant.', ephemeral: true });
            }
        }

        // ---------- BOUTON TOGGLE RÔLE ----------
        if (interaction.isButton() && interaction.customId.startsWith('role_')) {
            const roleIdMap = {
                'role_games': '1531832874599448666',
                'role_events': '1531832965565517924',
                'role_announcements': '1531832965565517924'
            };
            const roleId = roleIdMap[interaction.customId];
            if (!roleId) return interaction.reply({ content: '❌ Rôle introuvable.', ephemeral: true });
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return interaction.reply({ content: '❌ Rôle introuvable.', ephemeral: true });
            if (member.roles.cache.has(roleId)) {
                await member.roles.remove(role).catch(() => {});
                await interaction.reply({ content: `➖ Rôle retiré.`, ephemeral: true });
            } else {
                await member.roles.add(role).catch(() => {});
                await interaction.reply({ content: `➕ Rôle ajouté.`, ephemeral: true });
            }
        }

        // ---------- BOUTON TICKET ----------
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
            await tc.send({ content: null, embeds: [new EmbedBuilder().setColor('#c9a961').setTitle(`🎫 Ticket de ${member.user.username}`).setDescription('Bonjour ! Décrivez votre problème, l\'équipe arrive.').setFooter({ text: 'Zone Gaming QC', iconURL: CONFIG.logoUrl })] });
            await interaction.reply({ content: `✅ Ticket créé : ${tc}`, ephemeral: true });
            sendLog(guild, 'Ticket Ouvert', [
                { name: 'Utilisateur', value: `${member.user.tag}`, inline: true },
                { name: 'Salon', value: `${tc}`, inline: true }
            ], '#c9a961', `ticket_${member.id}`);
        }

        // ---------- BOUTONS CANDIDATURE ----------
        if (interaction.isButton() && (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_'))) {
            if (!member.roles.cache.has(CONFIG.staffRoleId)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            const ok = interaction.customId.startsWith('approve_');
            const cid = interaction.customId.split('_')[1];
            const color = ok ? 0x059669 : 0xdc2626;
            const e = new EmbedBuilder().setColor(color).setTitle(ok ? '✅ Candidature Approuvée !' : '❌ Candidature Refusée')
                .setDescription('Ta candidature a été traitée par l\'équipe de direction.')
                .addFields({ name: 'Décision', value: ok ? 'Acceptée' : 'Refusée', inline: true }, { name: 'Par', value: `${interaction.user.tag}`, inline: true })
                .setFooter({ text: 'Zone Gaming QC', iconURL: CONFIG.logoUrl }).setTimestamp();
            if (process.env.WEBHOOK_REPONSE) {
                await fetch(process.env.WEBHOOK_REPONSE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `<@${cid}>`, embeds: [e.toJSON()] }) }).catch(() => {});
            }
            await interaction.reply({ content: `✅ Réponse envoyée.`, ephemeral: true });
        }

        // ---------- /CLEAR ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'clear') {
            if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: ' Permission requise.', ephemeral: true });
            const n = interaction.options.getInteger('nombre');
            if (n < 1 || n > 100) return interaction.reply({ content: '❌ Entre 1 et 100.', ephemeral: true });
            const deleted = await interaction.channel.bulkDelete(n, true).catch(() => []);
            await interaction.reply({ content: `🗑️ ${deleted.size} message(s) supprimé(s).`, ephemeral: true });
            sendLog(interaction.guild, 'Clear', [
                { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true },
                { name: 'Messages', value: `${deleted.size}`, inline: true }
            ], '#d97706', `clear_${interaction.channel.id}`);
        }

        // ---------- /LOCK & /UNLOCK ----------
        if (interaction.isChatInputCommand() && (interaction.commandName === 'lock' || interaction.commandName === 'unlock')) {
            if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission requise.', ephemeral: true });
            const lock = interaction.commandName === 'lock';
            await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: !lock }).catch(() => {});
            await interaction.reply({ content: lock ? '🔒 Verrouillé.' : '🔓 Déverrouillé.', ephemeral: true });
            sendLog(interaction.guild, `Salon ${lock ? 'Verrouillé' : 'Déverrouillé'}`, [
                { name: 'Salon', value: `${interaction.channel}`, inline: true },
                { name: 'Modérateur', value: `${interaction.user.tag}`, inline: true }
            ], lock ? '#dc2626' : '#059669', `lock_${interaction.channel.id}`);
        }

        // ---------- /TRANSLATE ----------
        if (interaction.isChatInputCommand() && interaction.commandName === 'translate') {
            const text = interaction.options.getString('texte');
            const lang = interaction.options.getString('langue').toLowerCase();
            await interaction.deferReply();
            try {
                const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${lang}`);
                const j = await r.json();
                const tr = j?.responseData?.translatedText || 'Traduction indisponible.';
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#c9a961').setTitle(`🌐 Traduction (${lang})`)
                    .addFields({ name: 'Original', value: text.substring(0, 1000) }, { name: 'Traduit', value: tr.substring(0, 1000) })] });
            } catch (e) { await interaction.editReply({ content: '❌ Erreur de traduction.' }); }
        }

    } catch (error) {
        console.error('Erreur interaction:', error);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Erreur inattendue.', ephemeral: true }).catch(() => {});
    }
});

process.on('unhandledRejection', e => console.error('Rejet:', e));
process.on('uncaughtException', e => console.error('Exception:', e));

client.login(process.env.TOKEN);
