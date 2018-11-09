var fs = require('fs');
var express = require('express');
var axios = require('axios');
var request = require('request')
var jsforce = require('jsforce');

var obj = {
    'customerNumber': 'Codice_Cliente__c',
    'name': 'Name',
    'city': 'BillingCity'
}

var TOKEN_DIR = './';

// Salesforce
var cid = '*************';
var cs = '*************';
var cb = 'http://localhost:3000/auth';

var loginUrl = 'https://login.salesforce.com';
var authUrl = 'https://login.salesforce.com/services/oauth2/authorize';
var tokenUrl = 'https://login.salesforce.com/services/oauth2/token';

// Reviso
var secretId = '*************'
var appId = '*************'
var callback = 'http://localhost:3000/callback'

var revisoUrl = 'https://app.reviso.com/api1/requestaccess.aspx'
revisoUrl += '?appId=' + appId
revisoUrl += '&locale=en-GB'
revisoUrl += '&redirecturl=' + callback

// Token
var TOKEN_PATH_S = TOKEN_DIR + 'Salesforce_token.json';
var TOKEN_PATH_R = TOKEN_DIR + 'reviso_token.txt';

var credentials;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

var app = express();
app.listen(3000);

console.log('Reviso login: ' + revisoUrl)

doAuthorize(authUrl, function (credentials) {
    console.log('credentials:');
    if (credentials != null) {
        console.log(credentials);
    } else {
        console.log('please autheniticate');
    }
});

app.get('/auth', function (req, res) {
    var refresh_token = req.query.refresh_token;
    var code = req.query.code;
    console.log('refresh token: ' + refresh_token);
    console.log('code: ' + code)

    res.send('callback...');

    if (code != undefined) {
        console.log('code received, get token');
        doToken(tokenUrl, code);
    }

    if (refresh_token) {
        console.log('refresh_token received');
        console.log(refresh_token);
        saveSalesforceToken(refresh_token);
    }
});

app.get('/callback', function (req, res) {
    console.log('--- callback ---')
    var token = req.query.token
    console.log('Reviso token: ' + token)
    res.sendStatus(200)

    saveRevisoToken(token, TOKEN_PATH_R, function () {
        setConnection(0)
    })
})

function doAuthorize(url, callback) {
    console.log(TOKEN_PATH_S)
    fs.readFile(TOKEN_PATH_S, function (err, token) {
        if (err) {
            console.log('cannot find files');
            doLogin(url);
            callback(null);
        } else {
            console.log('credentials from file: ')
            credentials = JSON.parse(token)
            console.log(credentials);
            callback(credentials);
        }
    });
}


function doLogin(baseurl) {
    var url = baseurl;
    url += '?response_type=code';
    url += '&client_id=' + encodeURIComponent(cid);
    url += '&redirect_uri=' + cb;

    console.log(url);
    axios.get(url)
        .then(function (response) {
            if (response.status == 200) {
                console.log('Please authenticate via this url in the browser:');
                console.log(response.request.res.responseUrl);
            } else {
                console.log('Error on authenticate:');
                console.log(response.data.url);
                console.log(response.data.explanation);
            }
        })
        .catch(function (error) {
            console.log('error!!');
            console.log(error.response.data);
        })
}

function doToken(baseurl, code) {
    var url = baseurl;
    url += '?grant_type=authorization_code';
    url += '&client_id=' + cid;
    url += '&client_secret=' + cs;
    url += '&code=' + code;
    url += '&redirect_uri=' + cb;

    axios.get(url)
        .then(function (response) {
            console.log('access_token' + response.data.access_token);
            console.log('refresh_token ' + response.data.refresh_token);
            console.log('instance_url ' + response.data.instance_url);
            console.log('issued_at ' + response.data.issued_at);
            saveSalesforceToken(response.data);
        })
        .catch(function (error) {
            console.log(error);
        });
}

function getRevisoClients(n, callback) {
    var token = fs.readFileSync(TOKEN_PATH_R)
    var options = {
        url: 'https://rest.reviso.com/customers?skippages=' + n + '&pagesize=200',
        headers: {
            'X-AppSecretToken': secretId,
            'X-AgreementGrantToken': token,
            'Content-Type': 'application/json'
        }
    }

    request.get(options, function (err, response, body) {
        if (err) throw err
        console.log(body)
        callback(body)
    })
}

function formatClients(clients, callback) {
    var objs = []
    console.log('--- formatting clients ---')
    console.log(obj)
    clients.collection.forEach(function (d, i) {
        var field = {}
        console.log(d)
        Object.keys(d).forEach(function (k) {
            console.log('obj[k] = ' + obj[k])
            if (obj[k] != undefined) {
                field[obj[k]] = d[k]
            }
        })
        console.log('inserimento di:')
        console.log(field)
        objs.push(field)

    })
    callback(objs)
}

function saveSalesforceToken(refresh_token) {
    console.log('salva il token');
    try {
        fs.mkdirSync(TOKEN_DIR);
    } catch (err) {
        if (err.code != 'EEXIST') {
            // throw err;
        }
    }
    fs.writeFile(TOKEN_PATH_S, JSON.stringify(refresh_token), function () { });
    console.log('Token stored to ' + TOKEN_PATH_S);
}

function saveRevisoToken(token, path, callback) {
    console.log('Try to store token ' + token + ' in ' + path)
    try {
        fs.writeFileSync(TOKEN_PATH_R, token)
        console.log('Token stored!')
    } catch (err) {
        throw err
    }
    callback()
}

function setConnection(i) {
    getRevisoClients(i, function (body) {
        var clients = JSON.parse(body)
        console.log(clients.pagination.results)
        console.log('------ ' + i + ' ------')
        formatClients(clients, function (objs) {
            var conn = new jsforce.Connection({
                oauth2: {
                    loginUrl: loginUrl,
                    clientId: cid,
                    clientSecret: cs,
                    redirectUri: cb
                },
                instanceUrl: credentials.instance_url,
                accessToken: credentials.access_token,
                refreshToken: credentials.refresh_token,
                maxRequest: 200
            });

            conn.on("refresh", function (accessToken, res) {
                console.log('token refresh')
                credentials.access_token = accessToken;
            })

            console.log('objs = ' + objs.length)

            conn.oauth2.refreshToken(credentials.refresh_token)
                .then(function (resp) {
                    credentials.access_token = resp.access_token;

                    doUpsert(objs, conn, function (err) {
                        if (err) throw err
                        if ((i + 1) * 200 >= clients.pagination.results - 1) {
                        console.log('exit')
                        // process.exit(0)
                    } else {
                        i++
                        setConnection(i)
                    }
                    })
                    
                })
                .catch(function (err) {
                    console.log('refresh error...')
                    console.log(err)
                })
        })

    })
}

function doUpsert(objs, conn, callback) {
    while (objs.length > 0) {
        o = objs.slice(0, 200)
        objs.splice(0, 200)
        console.log('upserting')
        console.log(o)
        conn.sobject("Account").upsert(o, 'Codice_Cliente__c', function (err, rets) {
            console.log('ciao')
            if (err) {
                console.log(err)
                callback(err)
            }
            for (var i = 0; i < rets.length; i++) {
                console.log(rets[i])
            }
            if (rets.length < 200) {
                console.log(rets)
            }
        })
    }
    callback(null)
}
