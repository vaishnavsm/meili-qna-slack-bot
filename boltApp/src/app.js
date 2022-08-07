require('dotenv').config();

const { App } = require('@slack/bolt');
const { MeiliSearch } = require('meilisearch')
const crypto = require('crypto');
const meili = new MeiliSearch({ host: process.env.MEILI_HOST, apiKey: process.env.MEILI_KEY });
const SEARCH_INDEX = 'searchdocs';
const MAX_RESULTS = 3;
const teams = [
    {
        id: 'eng',
        name: 'Engineering'
    },
    {
        id: 'sales',
        name: 'Sales'
    },
    {
        id: 'mrkting',
        name: 'Marketing'
    },
];

const userIdToTeamId = {
    'U02JJAE8H34': 'eng',
};

// Initializes your app with your bot token and signing secret
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const isUrl = (str) => {
    if(!str || typeof str !== 'string') return false;
    try {
        const url = new URL(str);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
        return false;  
    }
};

const MEILI_LIMIT = 60000;
const limitToMeili = (data) => {
    if(typeof data !== 'string') return data;
    if(data.length < MEILI_LIMIT) return data;
    return data.slice(0, MEILI_LIMIT);
}

const addToMeili = async ({uid, type, link, phrase, description}) => {
    await meili.index(SEARCH_INDEX).addDocuments([
        {
            uid,
            phrases: [limitToMeili(phrase)],
            link,
            description: limitToMeili(description),
            type,
            howGoodAmI: 0,
            ts: new Date().getTime(),
        }
    ]);
};

app.message(/^add /i, async ({message, say}) => {
    if(message.channel_type !== 'im') return;
    const phrase = message.text.slice(4);

    console.log(message);
    
    if(message.attachments && message.attachments[0] && message.attachments[0].is_share) {
        // Try to see if it's a link or a message
        if(isUrl(message.attachments[0].text)) {
            // it's a link
            const link = message.attachments[0].text;
            const uid = crypto.createHash('sha256').update(link).digest('hex').toString();
            say({
                text: `Added ${link} under \`${phrase}\`.`,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `I have added the link <${link}> under \`${phrase}\`. Thank you for improving our knowledgebase!`
                        }
                    },
                    {
                        type: 'actions',
                        "elements": [
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": ":no_good: This was a mistake, undo!",
                                    "emoji": true
                                },
                                "value": uid,
                                "action_id": "undo-add"
                            },
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": ":books: Add to a team",
                                    "emoji": true
                                },
                                "value": uid,
                                "action_id": "team-add"
                            },
                        ],
                    }
                ]
            });
            await addToMeili({
                uid,
                type: 'link',
                link,
                phrase
            });
        } else {
            const link = message.attachments[0].from_url;
            const uid = crypto.createHash('sha256').update(link).digest('hex').toString();
            say({
                text: `Added slack message under \`${phrase}\`.`,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `I have added the the slack message you shared under \`${phrase}\`. Thank you for improving our knowledgebase!`
                        }
                    },
                    {
                        type: 'actions',
                        "elements": [
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": ":no_good: This was a mistake, undo!",
                                    "emoji": true
                                },
                                "value": uid,
                                "action_id": "undo-add"
                            },
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": ":books: Add to a team",
                                    "emoji": true
                                },
                                "value": uid,
                                "action_id": "team-add"
                            },
                        ],
                    }
                ]
            });
            await addToMeili({
                uid,
                type: 'slack',
                link,
                phrase,
                description: message.attachments[0].text
            });
        }
        return;
    }

    // Try to see if we're asked to add a link
    // syntax add "phrase" link
    const [ignore, quotedPhrase, link] = phrase.split('"').map(x => x.trim && x.trim());
    if(link && isUrl(link)) {
        const uid = crypto.createHash('sha256').update(link).digest('hex').toString();
        say({
            text: `Added ${link} under \`${quotedPhrase}\`.`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `I have added the link <${link}> under \`${quotedPhrase}\`. Thank you for improving our knowledgebase!`
                    }
                },
                {
                    type: 'actions',
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": ":no_good: This was a mistake, undo!",
                                "emoji": true
                            },
                            "value": uid,
                            "action_id": "undo-add"
                        },
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": ":books: Add to a team",
                                "emoji": true
                            },
                            "value": uid,
                            "action_id": "team-add"
                        },
                    ],
                }
            ]
        });
        await addToMeili({
            uid,
            type: 'link',
            link,
            phrase: quotedPhrase
        });
        return;
    }

    console.log("Couldn't add: ", message);
    say("Sorry, I'm not sure what you're trying to add!");
});

const find = async ({query, say, startIdx = 0, header = true, team = undefined}) => {
    const results = await meili.index(SEARCH_INDEX).search(query, {sort: ['howGoodAmI:desc', 'ts:desc'], filter: ['howGoodAmI > -3', ...(!team ? [] : [`team = "${team}"`])], offset: startIdx, limit: MAX_RESULTS});
    const teamError = team !== null ? [] : [{
        "type": "context",
        "elements": [
            {
                'type': 'mrkdwn',
                "text": ':warning: You asked for a team filter, but this user doesn\'t have a known team. Defaulting to full search',
            }
        ]
    }];
    if(results.estimatedTotalHits === 0 || results.hits.length === 0) {
        return say({
            text: "Couldn't find any hits on that!",
            blocks: [
                {
                    'type': 'section',
                    'text': {
                        'type': 'mrkdwn',
                        'text': "Sorry, we couldn't find any results appropriate for your query!"
                    }
                },
                {
                    'type': 'divider',
                },
                {
                    'type': 'section',
                    'text': {
                        'type': 'mrkdwn',
                        'text': "Please consider adding some answers to your answer by sharing a message with me and saying"
                    }
                },
                {
                    'type': 'section',
                    'text': {
                        'type': 'mrkdwn',
                        'text': `\`\`\`\nadd ${query}\n\`\`\``
                    }
                },
                ...teamError,
            ]
        });
    }

    let toSend = header ? [{
        text: `Found ${results.estimatedTotalHits} results for your query`,
        blocks: [
            {
                'type': 'section',
                'text': {
                    'type': 'mrkdwn',
                    'text': "We found a few results:",
                }
            },
        ]
    }] : [];

    toSend = [
        ...toSend,
        ...results.hits.slice(0,MAX_RESULTS).map(result => {
            return [
                {
                    "type": "divider"
                },
                {
                    'type': 'section',
                    'text': {
                        'type': 'mrkdwn',
                        'text': `<${result.link} | ${result.type === 'slack' ? 'Slack Thread' : 'Link'}>\n*Created* ${new Date(result.ts).toString().split(" ").slice(1,4).join(" ")}`+(!(result.team)?'':` | *Team:* ${teams.filter(x => x.id === result.team)[0]?.name}`),
                    },
                    "accessory": {
                        "type": "overflow",
                        "options": [
                            {
                                "text": {
                                    "type": "plain_text",
                                    "text": ":books: Add teams to this document",
                                    "emoji": true
                                },
                                "value": JSON.stringify({action: 'add-teams', id: result.uid})
                            },
                            {
                                "text": {
                                    "type": "plain_text",
                                    "text": ":zzz: This answer is irrelevant",
                                    "emoji": true
                                },
                                "value": JSON.stringify({action: 'irrelevant', id: result.uid, query})
                            },
                            {
                                "text": {
                                    "type": "plain_text",
                                    "text": ":zap: Remove this from knowledgebase",
                                    "emoji": true
                                },
                                "value": JSON.stringify({action: 'expired', id: result.uid, query})
                            },
                        ],
                        "action_id": "overflow"
                    }
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": ":white_check_mark: This is right",
                                "emoji": true
                            },
                            "value": JSON.stringify({id: result.uid, query}),
                            "action_id": "promote"
                        },
                    ],
                },
            ]
        }),
    ];

    const hasMore = ( results.estimatedTotalHits > (startIdx + MAX_RESULTS) ) && results.hits.length === MAX_RESULTS;

    toSend.push(
        [
            ...(!(hasMore) ? [] : [{
                "type": "actions",
                "elements": [
                    ...(!hasMore ? [] : [{
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": ":arrow_forward: More",
                            "emoji": true
                        },
                        "value": JSON.stringify({query, startIdx: Math.min(results.estimatedTotalHits - 1, startIdx+MAX_RESULTS)}),
                        "action_id": "printFindNext"
                    }]),
                ],
            }]),
            ...teamError,
            {
                "type": "context",
                "elements": [
                    {
                        'type': 'mrkdwn',
                        "text": `If you didn't find any of these satisfactory, please add more to the database by sharing a message with me and saying \`add ${query}\``,
                    }
                ]
            },
        ]
    );

    
    for(const send of toSend) {
        if(Array.isArray(send)) {
            await say({
                text: 'Answer',
                blocks: send
            })
        } else {
            await say(send);
        }
    }
}

app.message(/^find /i, async ({message, say}) => {
    if(message.channel_type !== 'im') return;
    const query = message.text.slice(5);
    await find({query, say});
});

app.message(/^team /i, async ({message, say}) => {
    console.log(message)
    if(message.channel_type !== 'im') return;
    const query = message.text.slice(5);
    const team = userIdToTeamId[message.user] || null;
    console.log("TEAM:",team);
    await find({query, say, team});
});

app.event("app_mention", async (mention) => {
    
    if(!mention.payload.text) return;
    const [_, command, ...rest] = mention.payload.text.split(' ');
    const query = rest.join(' ');

    
    const say = async (message) => mention.client.chat.postMessage({
        channel: mention.payload.channel,
        thread_ts: mention.payload.ts,
        ...message
    });
    
    if(command === 'find') {
        await find({query, say});
    }
    
    if(command === 'team') {
        const team = userIdToTeamId[mention.payload.user] || null;
        await find({query, say, team});
    }
});

const printFindAction = async (action) => {
    const updatedMessage = {
        channel: action.body.channel.id,
        ts: action.body.message.ts,
    };
    await action.client.chat.delete(updatedMessage);
    await action.ack();

    const newMessages = {
        channel: action.body.channel.id,
        thread_ts: action.body.message.thread_ts || undefined,
        text: action.body.message.text,
    };
    await action.ack();
    try {
        const {startIdx, query} = JSON.parse(action.body.actions[0].value);
        const say = async (message) => action.client.chat.postMessage({
            ...newMessages,
            ...message
        });
        await find({startIdx, query, say, header: false});
    } catch (err){
        console.log("Error during printFind", err)
    }
};

app.action('printFindPrev', printFindAction);
app.action('printFindNext', printFindAction);

app.action('team-add', async (action) => {
    
    await action.ack();
    const id = action.body.actions[0].value;
    const document = await meili.index(SEARCH_INDEX).getDocument(id);

    const mapTeam = team => ({
        "text": {
            "type": "plain_text",
            "text": team.name,
            "emoji": true
        },
        "value": JSON.stringify({teamId: team.id, documentId: id})
    });

    await action.client.chat.postEphemeral({
        channel: action.body.channel.id,
        user: action.body.user.id,
        text: 'Please select teams',
        blocks: [
            {
                "type": "input",
                "element": {
                    "type": "static_select",
                    "placeholder": {
                        "type": "plain_text",
                        "text": "Select Teams",
                        "emoji": true
                    },
                    "options": teams.map(mapTeam),
                    "action_id": "team-select-action",
                    ...(!document.team ? {} : {
                        "initial_option": mapTeam(teams.filter(x => x.id === document.team)[0])
                    }),
                },
                "label": {
                    "type": "plain_text",
                    "text": ":books: Teams",
                    "emoji": true
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": ":white_check_mark: Add These Teams",
                            "emoji": true
                        },
                        "value": id,
                        "action_id": "finalize-add"
                    },
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": ":x: Cancel",
                            "emoji": true
                        },
                        "value": id,
                        "action_id": "cancel-add"
                    },
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": ":no_entry: Clear all teams",
                            "emoji": true
                        },
                        "value": id,
                        "action_id": "clear-teams"
                    },
                ]
            },
        ]
    }).catch(err => console.log(JSON.stringify(err)));
});

const _teamAddCache = {};

app.action('finalize-add', async (action) => {
    await action.client.chat.postEphemeral({
        channel: action.body.container.channel_id,
        user: action.body.user.id,
        text: ":ok: Added change!",
        blocks: [{
            'type': 'section',
            'text': {
                'type': 'mrkdwn',
                'text': `:ok:  We have saved your changes!`,
            },
        }]
    })

    await action.ack();
    
    try{    
        const id = action.body.actions[0].value;
        if(!(id in _teamAddCache)) return;
        const document = await meili.index(SEARCH_INDEX).getDocument(id);
        document.team = _teamAddCache[id];
        
        await meili.index(SEARCH_INDEX).updateDocuments([document]);
        delete _teamAddCache[id];
    } catch (_) {
        console.log("Failed somewhere in finalize-add", _);
    }
});

app.action('cancel-add', async (action) => {
    await action.client.chat.postEphemeral({
        channel: action.body.container.channel_id,
        user: action.body.user.id,
        text: ":ok: Added change!",
        blocks: [{
            'type': 'section',
            'text': {
                'type': 'mrkdwn',
                'text': `:ok:  We have cancelled your changes!`,
            },
        }]
    })
    await action.ack();

    const id = action.body.actions[0].value;
    if(id in _teamAddCache) delete _teamAddCache[id];
});

app.action('clear-teams', async (action) => {
    await action.client.chat.postEphemeral({
        channel: action.body.container.channel_id,
        user: action.body.user.id,
        text: ":ok: Added change!",
        blocks: [{
            'type': 'section',
            'text': {
                'type': 'mrkdwn',
                'text': `:ok:  We have cleared the team!`,
            },
        }]
    })
    await action.client.chat.update(updatedMessage);
    await action.ack();

    const id = action.body.actions[0].value;
    const document = await meili.index(SEARCH_INDEX).getDocument(id);
    document.team = null;
    await meili.index(SEARCH_INDEX).updateDocuments([document]);
    delete _teamAddCache[id];
});

app.action('team-select-action', async (action) => {
    await action.ack();
    try {
        const {documentId, teamId} = JSON.parse(action.body.actions[0].selected_option.value);
        _teamAddCache[documentId] = teamId;
    } catch(_){
        console.log("Failed somewhere in team-select-action", _);
    }
});

app.action('undo-add', async (action) => {
    const updatedMessage = {
        channel: action.body.channel.id,
        ts: action.body.message.ts,
        text: action.body.message.text,
        blocks: action.body.message.blocks,
    };
    updatedMessage.blocks = [{
        'type': 'section',
        'text': {
            'type': 'mrkdwn',
            'text': `:ok:  We have un-added this!`,
        },
    }]
    await action.client.chat.update(updatedMessage);
    await action.ack();

    try{
        const id = action.body.actions[0].value;
        await meili.index(SEARCH_INDEX).deleteDocument(id);
    } catch (_) {
        console.log("Failed somewhere in undo-add", _);
    }
});

app.action('promote', async (action) => {
    const updatedMessage = {
        channel: action.body.channel.id,
        ts: action.body.message.ts,
        text: action.body.message.text,
        blocks: action.body.message.blocks,
    };
    updatedMessage.blocks[2] = {
        'type': 'section',
        'text': {
            'type': 'mrkdwn',
            'text': `:ok:  We have updated the knowledgebase`,
        },
    }
    await action.client.chat.update(updatedMessage);
    await action.ack();

    try{
        const {id, query} = JSON.parse(action.body.actions[0].value);
        const document = await meili.index(SEARCH_INDEX).getDocument(id).catch(_ => {console.log("Meili load error", _); return null;});
        if(!document) return;
        if(!document.phrases.includes(query)) document.phrases.push(query);
        document.howGoodAmI = (document.howGoodAmI || 0) + 1;
        await meili.index(SEARCH_INDEX).updateDocuments([document]);
    } catch (_) {
        console.log("Failed somewhere", _);
    }
});

app.action('overflow', async (action) => {
    try {
        const {action: type, id, query} = JSON.parse(action.body.actions[0].selected_option.value);
        if(type !== 'add-teams') {
            const updatedMessage = {
                channel: action.body.channel.id,
                ts: action.body.message.ts,
                text: action.body.message.text,
                blocks: action.body.message.blocks,
            };
            updatedMessage.blocks[1].accessory = undefined;
            updatedMessage.blocks[2] = {
                'type': 'section',
                'text': {
                    'type': 'mrkdwn',
                    'text': `:ok:  We have updated the knowledgebase`,
                },
            }
            await action.client.chat.update(updatedMessage);
        }
        await action.ack();
        if(type === 'expired') {
            await meili.index(SEARCH_INDEX).deleteDocument(id);
        } else if (type === 'irrelevant') {
            const document = await meili.index(SEARCH_INDEX).getDocument(id).catch(_ => {console.log("Meili load error", _); return null;});
            if(!document) return;
            document.phrases = document.phrases.filter(x => x !== query);
            document.howGoodAmI = (document.howGoodAmI || 0) - 1;
            await meili.index(SEARCH_INDEX).updateDocuments([document]);
        } else if (type === 'add-teams') {
            const document = await meili.index(SEARCH_INDEX).getDocument(id);

            const mapTeam = team => ({
                "text": {
                    "type": "plain_text",
                    "text": team.name,
                    "emoji": true
                },
                "value": JSON.stringify({teamId: team.id, documentId: id})
            });
            await action.client.chat.postEphemeral({
                channel: action.body.channel.id,
                user: action.body.user.id,
                thread_ts: action.body.message.thread_ts || undefined,
                text: 'Please select teams',
                blocks: [
                    {
                        "type": "input",
                        "element": {
                            "type": "multi_static_select",
                            "placeholder": {
                                "type": "plain_text",
                                "text": "Select Teams",
                                "emoji": true
                            },
                            "options": teams.map(mapTeam),
                            "action_id": "team-select-action",
                            ...(!document.teams || document.teams.length === 0 ? {} : {
                                "initial_options": document.teams.map(mapTeam)
                            }),
                        },
                        "label": {
                            "type": "plain_text",
                            "text": ":books: Teams",
                            "emoji": true
                        }
                    },
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": ":white_check_mark: Add These Teams",
                                    "emoji": true
                                },
                                "value": id,
                                "action_id": "finalize-add"
                            },
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": ":x: Cancel",
                                    "emoji": true
                                },
                                "value": id,
                                "action_id": "cancel-add"
                            },
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": ":no_entry: Clear all teams",
                                    "emoji": true
                                },
                                "value": id,
                                "action_id": "clear-teams"
                            },
                        ]
                    },
                ]
            }).catch(err => console.log(JSON.stringify(err)));
        }
    } catch (err) {
        console.log("Failed somewhere in overflow", err);
    }
});

(async () => {
    // meili = new MeiliSearch({ host: process.env.MEILI_HOST });
    await Promise.all([
        meili.index(SEARCH_INDEX).updateDisplayedAttributes(['link', 'description', 'type', 'uid', 'howGoodAmI', 'phrases', 'ts', 'team']),
        meili.index(SEARCH_INDEX).updateSearchableAttributes(['phrases', 'description']),
        meili.index(SEARCH_INDEX).updateFilterableAttributes(['howGoodAmI', 'team']),
        meili.index(SEARCH_INDEX).updateSortableAttributes(['howGoodAmI', 'ts']),
    ]);

    // Start your app
    await app.start(process.env.PORT || 3000);

    console.log('⚡️ Bolt app is running!');
})();