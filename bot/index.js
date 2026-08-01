const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, PermissionFlagsBits, Events, ChannelType 
} = require('discord.js');
const http = require('http');

// ✅ Vérification des variables d'environnement
if (!process.env.TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.error('❌ Variables manquantes ! Vérifie Render (TOKEN, CLIENT_ID, GUILD_ID, DISCORD_CLIENT_SECRET).');
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

const CONFIG = {
    welcomeChannelId: '1531832075454255216',
    goodbyeChannelId: '1531832012493688872',
    staffRoleId: '1531835193395122186',
    logsChannelId: '1531829572914511955',
    ticketCategoryId: '1531833907438289018'
};

// ✅ SERVEUR HTTP POUR RENDER & API
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // 1. Health check
    if (req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
        return;
    }

    // 2. Endpoint Authentification Discord OAuth2
    if (req.url === '/api/auth/discord' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { code } = JSON.parse(body);
                const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
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
                
                const tokenData = await tokenResponse.json();
                if (!tokenResponse.ok) throw new Error(tokenData.error_description || 'Erreur OAuth2');
                
                const userResponse = await fetch('https://discord.com/api/users/@me', {
                    headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
                });
                const userData = await userResponse.json();
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    user: { 
                        id: userData.id, 
                        username: userData.username, 
                        discriminator: userData.discriminator || '0', 
                        avatar: userData.avatar 
                    }
                }));
            } catch (error) {
                console.error('Erreur auth Discord:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        });
        return;
    }

    // 3. Endpoint Candidature
    if (req.url === '/api/candidature' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                if (!client.isReady()) {
                    res.writeHead(503);
                    res.end('Bot pas encore prêt');
                    return;
                }

                const data = JSON.parse(body);
                const guild = client.guilds.cache.get(process.env.GUILD_ID);
                const staffChannel = guild.channels.cache.find(c => c.name === 'candidatures-staff' || c.name === 'admin');

                if (!staffChannel) {
                    console.error('Salon staff non trouvé.');
                    res.writeHead(500);
                    res.end('Salon staff non trouve');
                    return;
                }

                const embed = new EmbedBuilder()
                    .setColor('#c9a961')
                    .setTitle('📋 Nouvelle Candidature Staff')
                    .setDescription(`**Candidat:** ${data.discordPseudo}\n**ID:** \`${data.discordId}\``)
                    .addFields(
                        { name: 'Disponibilité', value: data.disponibilite, inline: true },
                        { name: 'Expérience', value: data.experience.substring(0, 1024), inline: false },
                        { name: 'Motivation', value: data.motivation.substring(0, 1024), inline: false }
                    )
                    .setFooter({ text: 'Zone Gaming QC | Candidature Staff' })
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`approve_staff_${data.discordId}`).setLabel('Approuver').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId(`deny_staff_${data.discordId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );

                await staffChannel.send({ embeds: [embed], components: [row] });
                res.writeHead(200);
                res.end('OK');
            } catch (error) {
                console.error('Erreur API candidature:', error);
                res.writeHead(500);
                res.end('Erreur interne');
            }
        });
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(process.env.PORT || 3000, () => {
    console.log(`🌐 Health check et API actifs sur le port ${process.env.PORT || 3000}`);
});

// --- ÉVÉNEMENTS DISCORD ---
client.once('clientReady', () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    client.user.setActivity('Zone Gaming QC', { type: 'WATCHING' });
    registerCommands();
});

async function registerCommands() {
    const commands = [
        { 
            name: 'ban', 
            description: 'Bannir un utilisateur', 
            options: [
                { name: 'utilisateur', type: 6, required: true, description: 'L\'utilisateur à bannir' },
                { name: 'raison', type: 3, required: false, description: 'Raison du ban' }
            ] 
        },
        { 
            name: 'setup-ticket', 
            description: 'Envoyer le panneau de création de ticket',
            options: [{ name: 'salon', type: 7, required: true, description: 'Le salon où envoyer le panneau', channel_types: [0] }]
        },
        { 
            name: 'setup', 
            description: 'Configurer les embeds professionnels du serveur',
            options: [{ 
                name: 'type', 
                type: 3, 
                required: true, 
                description: 'Le type de configuration à envoyer',
                choices: [
                    { name: '📜 Règlements', value: 'rules' },
                    { name: '🎭 Rôles & Notifications', value: 'roles' },
                    { name: '🎫 Support / Tickets', value: 'tickets' },
                    { name: '️ Recrutement Staff', value: 'staff' },
                    { name: '🚀 TOUT (Recommandé)', value: 'all' }
                ]
            }]
        }
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ Commandes Slash enregistrées !');
    } catch (error) {
        console.error('❌ Erreur registration commandes:', error);
    }
}

client.on(Events.GuildMemberAdd, async (member) => {
    const channel = member.guild.channels.cache.get(CONFIG.welcomeChannelId);
    if (!channel) return;
    const embed = new EmbedBuilder()
        .setColor('#c9a961')
        .setTitle('🎉 Bienvenue sur Zone Gaming QC !')
        .setDescription(`Salut ${member}, ravi de te compter parmi nous !\n\n Lis le <#1531831739431911486>\n Prends tes rôles dans <#1531832520016924793>`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `Membre n°${member.guild.memberCount}` })
        .setTimestamp();
    await channel.send({ content: `${member}`, embeds: [embed] }).catch(console.error);
});

client.on(Events.GuildMemberRemove, async (member) => {
    const channel = member.guild.channels.cache.get(CONFIG.goodbyeChannelId);
    if (!channel) return;
    const embed = new EmbedBuilder()
        .setColor('#dc2626')
        .setTitle('👋 Départ')
        .setDescription(`${member.user.tag} a quitté le serveur.`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();
    await channel.send({ embeds: [embed] }).catch(console.error);
});

// --- INTERACTIONS & COMMANDES ---
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        // ==========================================
        // COMMANDE /SETUP (Embeds Professionnels)
        // ==========================================
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return interaction.reply({ content: '❌ Tu dois avoir la permission "Gérer les salons" pour utiliser cette commande.', ephemeral: true });
            }

            const type = interaction.options.getString('type');
            const channel = interaction.channel;
            await interaction.deferReply({ ephemeral: true });

            const websiteLink = 'https://jacobin904.github.io/Zone-Gaming-QC/';
            const discordLink = 'https://discord.gg/d8g2eztfbM';

            try {
                if (type === 'rules' || type === 'all') {
                    const rulesEmbed = new EmbedBuilder()
                        .setColor('#c9a961')
                        .setTitle(' Règlements de Zone Gaming QC')
                        .setDescription('En rejoignant ce serveur, vous acceptez de respecter les règles suivantes. Le non-respect entraînera des sanctions.')
                        .addFields(
                            { name: '1️⃣ Respect & Tolérance', value: 'Insultes, harcèlement ou discrimination = BAN IMMÉDIAT.', inline: false },
                            { name: '2️⃣ Langue', value: 'Le français est la langue principale. Évitez le langage SMS excessif.', inline: true },
                            { name: '3️⃣ Contenu NSFW', value: 'Strictement interdit (images, liens, pseudos offensants).', inline: true },
                            { name: '4️⃣ Spam & Publicité', value: 'Flood et pub sans accord du staff sont interdits.', inline: true },
                            { name: '5️⃣ Vocal', value: 'Pas de cris, soundboards ou musique forte sans casque.', inline: true },
                            { name: '6️⃣ Autorité du Staff', value: 'Les décisions sont finales. Contestation en privé uniquement.', inline: true },
                            { name: '7️⃣ Vie Privée', value: 'Ne partagez pas vos infos personnelles ou celles des autres (doxxing).', inline: true },
                            { name: '8️⃣ Spoilers', value: 'Utilisez la balise ||spoiler|| pour les sorties récentes.', inline: true },
                            { name: '9️⃣ Sanctions', value: '⚠️ Avertissement ️ 🔇 Mute ➡️  Kick ➡️ 🔨 Ban.', inline: false }
                        )
                        .setFooter({ text: 'Zone Gaming QC', iconURL: 'https://cdn.discordapp.com/icons/1531829572453007533/c69bf91096081b8274e81a0a0eefa18e.webp?size=1024' })
                        .setTimestamp();
                    await channel.send({ embeds: [rulesEmbed] });
                }

                if (type === 'roles' || type === 'all') {
                    const rolesEmbed = new EmbedBuilder()
                        .setColor('#c9a961')
                        .setTitle('🎭 Attribution des Rôles')
                        .setDescription('Clique sur les boutons ci-dessous pour personnaliser ton expérience sur le serveur !')
                        .setFooter({ text: 'Zone Gaming QC', iconURL: 'https://cdn.discordapp.com/icons/1531829572453007533/c69bf91096081b8274e81a0a0eefa18e.webp?size=1024' });
                    
                    const rolesRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('role_games').setLabel('🎮 Notifications Jeux').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('role_events').setLabel('🎉 Notifications Events').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('role_announcements').setLabel('📢 Notifications Annonces').setStyle(ButtonStyle.Secondary)
                    );
                    await channel.send({ embeds: [rolesEmbed], components: [rolesRow] });
                }

                if (type === 'tickets' || type === 'all') {
                    const ticketEmbed = new EmbedBuilder()
                        .setColor('#c9a961')
                        .setTitle('🎫 Centre de Support')
                        .setDescription('Besoin d\'aide, d\'une modération ou d\'une réponse rapide ?\nNotre équipe est là pour toi.')
                        .addFields({ name: ' Conseil', value: 'Décris ton problème en détail lors de l\'ouverture du ticket pour une réponse plus rapide.' })
                        .setFooter({ text: `Zone Gaming QC | Site: ${websiteLink}`, iconURL: 'https://cdn.discordapp.com/icons/1531829572453007533/c69bf91096081b8274e81a0a0eefa18e.webp?size=1024' });

                    const ticketRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('open_ticket').setLabel('Ouvrir un ticket').setStyle(ButtonStyle.Primary).setEmoji('📩')
                    );
                    await channel.send({ embeds: [ticketEmbed], components: [ticketRow] });
                }

                if (type === 'staff' || type === 'all') {
                    const staffEmbed = new EmbedBuilder()
                        .setColor('#c9a961')
                        .setTitle('🛡️ Rejoindre l\'Équipe Staff')
                        .setDescription('Tu es motivé, mature et passionné par l\'animation de communauté ?\nNous cherchons régulièrement de nouveaux talents pour renforcer notre équipe.')
                        .addFields(
                            { name: '✅ Ce que nous cherchons', value: '• Maturité et esprit d\'équipe\n• Disponibilité régulière\n• Envie d\'aider la communauté' },
                            { name: '📝 Comment postuler ?', value: 'Rends-toi sur notre site web officiel pour remplir le formulaire sécurisé.' }
                        )
                        .setFooter({ text: `Zone Gaming QC | Site: ${websiteLink}`, iconURL: 'https://cdn.discordapp.com/icons/1531829572453007533/c69bf91096081b8274e81a0a0eefa18e.webp?size=1024' });

                    const staffRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Postuler sur le Site Web')
                            .setStyle(ButtonStyle.Link)
                            .setURL('https://jacobin904.github.io/Zone-Gaming-QC/Postuler/')
                            .setEmoji('🌐')
                    );
                    await channel.send({ embeds: [staffEmbed], components: [staffRow] });
                }

                await interaction.editReply({ content: `✅ Configuration **${type === 'all' ? 'complète' : type}** envoyée avec succès dans ce salon !` });

            } catch (error) {
                console.error('Erreur setup:', error);
                await interaction.editReply({ content: '❌ Une erreur est survenue lors de l\'envoi du setup.' });
            }
        }

        // ==========================================
        // COMMANDE /SETUP-TICKET
        // ==========================================
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup-ticket') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return interaction.reply({ content: '❌ Tu n\'as pas la permission d\'utiliser cette commande.', ephemeral: true });
            }
            
            const targetChannel = interaction.options.getChannel('salon');
            
            const embed = new EmbedBuilder()
                .setColor('#c9a961')
                .setTitle('🎫 Système de Support')
                .setDescription('Besoin d\'aide ? Clique sur le bouton ci-dessous pour ouvrir un ticket et l\'équipe de Zone Gaming QC te répondra rapidement.')
                .setFooter({ text: 'Zone Gaming QC' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('open_ticket')
                    .setLabel('Ouvrir un ticket')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📩')
            );

            await targetChannel.send({ embeds: [embed], components: [row] });
            await interaction.reply({ content: `✅ Panneau de ticket envoyé avec succès dans ${targetChannel} !`, ephemeral: true });
        }

        // ==========================================
        // BOUTON OUVRIR UN TICKET
        // ==========================================
        if (interaction.isButton() && interaction.customId === 'open_ticket') {
            const guild = interaction.guild;
            const member = interaction.member;
            
            const existingChannel = guild.channels.cache.find(c => c.name === `ticket-${member.user.username.toLowerCase()}` && c.parentId === CONFIG.ticketCategoryId);
            if (existingChannel) {
                return interaction.reply({ content: `❌ Tu as déjà un ticket ouvert : ${existingChannel}`, ephemeral: true });
            }

            const ticketChannel = await guild.channels.create({
                name: `ticket-${member.user.username.toLowerCase()}`,
                type: ChannelType.GuildText,
                parent: CONFIG.ticketCategoryId,
                permissionOverwrites: [
                    { id: guild.id, deny: ['ViewChannel'] },
                    { id: member.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                    { id: CONFIG.staffRoleId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'] }
                ]
            });

            const ticketEmbed = new EmbedBuilder()
                .setColor('#c9a961')
                .setTitle(`🎫 Ticket de ${member.user.username}`)
                .setDescription('Bonjour ! L\'équipe de support va te répondre dans les plus brefs délais.\nMerci de décrire ton problème en détail.')
                .setFooter({ text: 'Zone Gaming QC' });

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Fermer le ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒')
            );

            await ticketChannel.send({ content: `${member}`, embeds: [ticketEmbed], components: [closeRow] });
            await interaction.reply({ content: `✅ Ton ticket a été créé : ${ticketChannel} !`, ephemeral: true });
        }

        // ==========================================
        // BOUTON FERMER UN TICKET
        // ==========================================
        if (interaction.isButton() && interaction.customId === 'close_ticket') {
            if (!interaction.member.roles.cache.has(CONFIG.staffRoleId) && interaction.user.id !== interaction.channel.name.replace('ticket-', '')) {
                return interaction.reply({ content: '❌ Seule la personne qui a ouvert le ticket ou un membre du staff peut le fermer.', ephemeral: true });
            }
            
            await interaction.channel.send('🔒 Ce ticket va être fermé et supprimé dans 5 secondes...');
            setTimeout(async () => {
                await interaction.channel.delete().catch(console.error);
            }, 5000);
            
            await interaction.reply({ content: '✅ Ticket en cours de fermeture...', ephemeral: true });
        }

        // ==========================================
        // BOUTONS CANDIDATURE STAFF
        // ==========================================
        if (interaction.isButton() && (interaction.customId.startsWith('approve_staff_') || interaction.customId.startsWith('deny_staff_'))) {
            if (!interaction.member.roles.cache.has(CONFIG.staffRoleId)) {
                return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            }
            const isApprove = interaction.customId.startsWith('approve_staff_');
            const candidateId = interaction.customId.split('_')[2]; 

            const modal = new ModalBuilder()
                .setCustomId(`response_modal_${isApprove ? 'approve' : 'deny'}_${candidateId}`)
                .setTitle(isApprove ? '✅ Approuver la candidature' : '❌ Refuser la candidature');

            const input = new TextInputBuilder()
                .setCustomId('reason')
                .setLabel('Raison / Commentaire')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

        // ==========================================
        // MODAL RÉPONSE STAFF
        // ==========================================
        if (interaction.isModalSubmit() && interaction.customId.startsWith('response_modal_')) {
            const parts = interaction.customId.split('_');
            const action = parts[2]; 
            const candidateId = parts[3]; 
            const reason = interaction.fields.getTextInputValue('reason');
            
            const color = action === 'approve' ? 0x059669 : 0xdc2626;
            const title = action === 'approve' ? 'Candidature Approuvée !' : 'Candidature Refusée';
            
            const responseEmbed = new EmbedBuilder()
                .setColor(color)
                .setTitle(title)
                .setDescription(`Ta candidature pour le staff de **Zone Gaming QC** a été traitée.`)
                .addFields(
                    { name: 'Décision', value: action === 'approve' ? '✅ Acceptée' : '❌ Refusée', inline: true },
                    { name: 'Traitée par', value: `${interaction.user}`, inline: true },
                    { name: 'Raison', value: reason }
                )
                .setTimestamp();

            await fetch(process.env.WEBHOOK_REPONSE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `<@${candidateId}>`,
                    embeds: [responseEmbed.toJSON()]
                })
            });
            
            await interaction.reply({ content: '✅ Réponse envoyée au candidat.', ephemeral: true });
            
            const logChannel = interaction.guild.channels.cache.get(CONFIG.logsChannelId);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(color)
                    .setTitle('📬 Traitement Candidature')
                    .addFields(
                        { name: 'Action', value: action.toUpperCase(), inline: true },
                        { name: 'Staff', value: `${interaction.user}`, inline: true },
                        { name: 'Candidat ID', value: `\`${candidateId}\``, inline: true },
                        { name: 'Raison', value: reason }
                    );
                await logChannel.send({ embeds: [logEmbed] });
            }
        }

        // ==========================================
        // COMMANDE /BAN
        // ==========================================
        if (interaction.isChatInputCommand() && interaction.commandName === 'ban') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            }
            const target = interaction.options.getUser('utilisateur');
            const reason = interaction.options.getString('raison') || 'Aucune raison spécifiée';
            await interaction.guild.members.ban(target, { reason });
            
            const embed = new EmbedBuilder()
                .setColor('#dc2626')
                .setTitle('🔨 Bannissement')
                .setDescription(`${target} a été banni.`)
                .addFields({ name: 'Raison', value: reason })
                .setFooter({ text: `Par ${interaction.user.tag}` })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            
            const logChannel = interaction.guild.channels.cache.get(CONFIG.logsChannelId);
            if (logChannel) await logChannel.send({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Erreur interaction:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true }).catch(() => {});
        }
    }
});

process.on('unhandledRejection', error => console.error('Promesse rejetée:', error));
process.on('uncaughtException', error => console.error('Exception non capturée:', error));

client.login(process.env.TOKEN);
