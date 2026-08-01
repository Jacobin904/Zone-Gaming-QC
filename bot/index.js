const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, Events } = require('discord.js');
const http = require('http');

// ✅ PAS BESOIN DE DOTENV SUR RENDER (les vars sont injectées nativement)
// En local tu peux garder dotenv, mais sur Render c'est automatique.
if (!process.env.TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
    console.error('❌ Variables d\'environnement manquantes ! Vérifie ta config Render.');
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

// --- CONFIGURATION ---
const CONFIG = {
    welcomeChannelId: '1531832075454255216',
    goodbyeChannelId: '1531832012493688872',
    staffRoleId: '1531835193395122186',
    logsChannelId: '1531829572914511955'
};

// ✅ HEALTH CHECK POUR RENDER (Empêche le sleep)
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
    } else {
        res.writeHead(404);
        res.end();
    }
});
server.listen(process.env.PORT || 3000, () => {
    console.log(`🌐 Health check actif sur le port ${process.env.PORT || 3000}`);
});

client.once('clientReady', () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    client.user.setActivity('Zone Gaming QC', { type: 'WATCHING' });
    
    // ️ ENREGISTREMENT AUTO DES COMMANDES AU DÉMARRAGE (Plus besoin de script séparé)
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
        { name: 'ticket', description: 'Ouvrir un panneau de support' }
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ Commandes Slash enregistrées !');
    } catch (error) {
        console.error('❌ Erreur registration commandes:', error);
    }
}

// --- SYSTÈME BIENVENUE / AU REVOIR ---
client.on(Events.GuildMemberAdd, async (member) => {
    const channel = member.guild.channels.cache.get(CONFIG.welcomeChannelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor('#c9a961')
        .setTitle('🎉 Bienvenue sur Zone Gaming QC !')
        .setDescription(`Salut ${member}, ravi de te compter parmi nous !\n\n👉 Lis le <#1531831739431911486>\n Prends tes rôles dans <#1531832520016924793>`)
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

// Dans client.on(Events.InteractionCreate, ...)

// GESTION DES BOUTONS DE CANDIDATURE (Générés par le site web)
if (interaction.isButton() && (interaction.customId.startsWith('approve_staff_') || interaction.customId.startsWith('deny_staff_'))) {
    if (!interaction.member.roles.cache.has(CONFIG.staffRoleId)) {
        return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    }

    const isApprove = interaction.customId.startsWith('approve_staff_');
    const candidateId = interaction.customId.split('_')[2]; // Récupère l'ID stocké dans le custom_id

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

// TRAITEMENT DE LA RÉPONSE DU STAFF (Modal)
if (interaction.isModalSubmit() && interaction.customId.startsWith('response_modal_')) {
    const parts = interaction.customId.split('_');
    const action = parts[2]; // approve ou deny
    const candidateId = parts[3]; // ID du candidat
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

    try {
        // Envoi au Webhook de Réponse avec le ping du candidat
        await fetch(process.env.WEBHOOK_REPONSE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: `<@${candidateId}>`,
                embeds: [responseEmbed.toJSON()]
            })
        });
        
        await interaction.reply({ content: '✅ Réponse envoyée avec succès au candidat.', ephemeral: true });
        
        // Log interne
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
    } catch (err) {
        console.error('Erreur webhook réponse:', err);
        await interaction.reply({ content: '❌ Erreur lors de l\'envoi de la réponse.', ephemeral: true });
    }
}

    // COMMANDE /BAN
    if (interaction.isChatInputCommand() && interaction.commandName === 'ban') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
        }

        const target = interaction.options.getUser('utilisateur');
        const reason = interaction.options.getString('raison') || 'Aucune raison';

        try {
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
        } catch (err) {
            await interaction.reply({ content: ' Impossible de bannir.', ephemeral: true });
        }
    }

    // COMMANDE /TICKET
    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_ticket')
                .setLabel('Ouvrir un ticket')
                .setStyle(ButtonStyle.Primary)
        );
        await interaction.reply({ content: 'Clique ci-dessous pour ouvrir un support.', components: [row], ephemeral: true });
    }
});

// Gestion erreurs globales (évite le crash sur Render)
process.on('unhandledRejection', error => console.error('Promesse rejetée:', error));
process.on('uncaughtException', error => console.error('Exception non capturée:', error));

client.login(process.env.TOKEN);
