
var getHeaderInfo = require('../utils');

/* GET indi listing. */
function indiRouter(req, res, next) {

    var resData = getHeaderInfo(req);

    var async = require('async');
    var dbName = req.params.dbName;
    var pool = require('../db-config').createConnection(dbName);

    var indi = req.params.indi;

    var indiRes = {
        indi: indi,
        sources: [],
        stats: [],
        events: [],
        mother: {},
        father: {},
        families: [],
        photos: [],
        pedigree:''
        };

    var cnt = 0;


    async.parallel([
        getIndi,
        getISour,
        getIEvts,
        getParents,
        getFamilies,
        getPhotos,
        getPedigree
    ],
    function(err, values) {
        //console.log(JSON.stringify(indiRes, null, 2));
        pool.close();
        resData['indi'] = indiRes;
        res.render('indi', resData);
    });

    function getIndi(next) {
        pool.acquire(function(err, conn) {
            if (err) {
                console.error(err);
                next(err);
            }
            var sql = 'select indi, lname, fname, title, sex, refn, note, living from indi where indi=?';
            conn.query(sql, [indi], function(err, results) {
                if (err) {
                    console.error(err);
                    next(err);
                }

                if (results.rows.length > 0) {
                    var r = results.rows[0];
                    indiRes['indi'] = indi;
                    indiRes['lname'] = r.LNAME;
                    indiRes['fname'] = r.FNAME;
                    indiRes.stats.push({name: 'title', data: r.TITLE});
                    indiRes.stats.push({name: 'refn', data: r.REFN});
                    indiRes.stats.push({name: 'sex', data: r.SEX});
                    indiRes['note'] = r.NOTE;
                    resData['presumed'] = r.LIVING && !(req.session && req.session.user);
                }
                else {
                    console.error('Invalid indi ID');
                }
                pool.release(conn);
                next(null, 1);
            });
        });
    }

    function getISour(next) {
        pool.acquire(function(err, conn) {
            if (err) {
                console.error(err);
                next(err);
            }
            // columns: [SEQ, TEXT, SOUR, TITL, AUTH, PUBL, REPO]
            var sql = 'select a.seq, a.text, b.* from sourtxt a, sour b where a.sourid=b.sour and refid=? order by seq asc';
            conn.query(sql, [indi], function(err, results) {
                if (err) {
                    console.error(err);
                    next(err);
                }

                results.rows.forEach(function(r) {
                    indiRes.sources.push({
                        seq: r.SEQ,
                        text: r.TEXT,
                        sour: r.SOUR,
                        titl: r.TITL,
                        auth: r.AUTH,
                        publ: r.PUBL,
                        repo: r.REPO
                    });
                });
                pool.release(conn);
                next(null, 2);
            });
        });
    }

    function getIEvts(next) {
        pool.acquire(function(err, conn) {
            if (err) {
                console.error(err);
                next(err);
            }
            var sql = 'select a.* from events a left join eorder b on a.etype=b.etype where refid=? order by eorder asc';
            conn.query(sql, [indi], function(err, results) {
                if (err) {
                    console.error(err);
                    next(err);
                }

                results.rows.forEach(function(r) {
                    // TODO add filters for IsLiving(indi)
                    if (r.ETYPE != 'Social Security No.') {
                        indiRes.events.push({
                            etype: r.ETYPE,
                            date: r.DATE,
                            place: r.PLAC,
                            note: r.NOTE,
                            text: r.TEXT
                        });
                    }
                });
                pool.release(conn);
                next(null, 3);
            });
        });
    }

    function getParents(next) {
        pool.acquire(function(err, conn) {
            if (err) {
                console.error(err);
                next(err);
            }
            var sql = 'select d.* from indi a, child b, fami c, indi d where a.indi=b.indi and b.fami=c.fami and b.indi=? and d.indi in (c.husb,c.wife) order by d.sex asc';
            conn.query(sql, [indi], function(err, results) {
                if (err) {
                    console.error(err);
                    next(err);
                }

                results.rows.forEach(function(r) {
                    var ii = {
                        indi: r.INDI,
                        lname: r.LNAME,
                        fname: r.FNAME,
                        presumed: r.LIVING && !(req.session && req.session.user)
                    };
                    if (r.SEX == 'M') {
                        indiRes['father'] = ii;
                    }
                    else if (r.SEX == 'F') {
                        indiRes['mother'] = ii;
                    }
                });;
                pool.release(conn);
                next(null, 4);
            });
        });
    }

    function getFamilies(next) {
        async.series([
            getFams,
            getFamsDetails
        ],
        function (err, results) {
            next(null, 5);
        });
    }

    function getFamsDetails(next) {
        async.forEachOf(indiRes.families, function(item, idx, cb) {

            function getFamsEvents(next) {
                var fami = item.fami;
                pool.acquire(function(err, conn) {
                    if (err) {
                        console.error(err);
                        next(err);
                    }
                    var sql = 'select a.* from events a left join eorder b on a.etype=b.etype where refid=? order by eorder asc';
                    conn.query(sql, [fami], function(err, results) {
                        if (err) {
                            console.error(err);
                            next(err);
                        }

                        results.rows.forEach(function(r) {
                            indiRes.families[idx].events.push({
                                etype: r.ETYPE,
                                date: r.DATE,
                                place: r.PLAC,
                                note: r.NOTE,
                                text: r.TEXT
                            });
                        });
                        pool.release(conn);
                        next(null, 'E-'+fami);
                    });
                });
            }

            function getFamsChildren(next) {
                var fami = item.fami;
                pool.acquire(function(err, conn) {
                    if (err) {
                        console.error(err);
                        next(err);
                    }
                    var sql = 'select b.* from child a, indi b where a.indi=b.indi and a.fami=? order by a.seq asc';
                    conn.query(sql, [fami], function(err, results) {
                        if (err) {
                            console.error(err);
                            next(err);
                        }

                        results.rows.forEach(function(r) {
                            indiRes.families[idx].children.push({
                                indi: r.INDI,
                                lname: r.LNAME,
                                fname: r.FNAME,
                                sex: r.SEX,
                                presumed: r.LIVING && !(req.session && req.session.user)
                            });
                        });
                        pool.release(conn);
                        next(null, 'C-'+fami);
                    });
                });
            }

            async.parallel([
                getFamsEvents,
                getFamsChildren
            ],
            function(err, results) {
                cb(null, '5b');
            });
        },
        function(err, results) {
            next(null, '5c');
        });
    }

    function getFams(next) {
        pool.acquire(function(err, conn) {
            if (err) {
                console.error(err);
                next(err);
            }
            var sql = `select a.fami, b.note as mnote, c.*,
                (select group_concat(seq) from sourtxt where refid=a.fami) as source
                from fams a, fami b, indi c
                where a.fami=b.fami and c.indi in (husb,wife)
                    and a.indi=? and c.indi != ? order by a.seq asc`;
            conn.query(sql, [indi, indi], function(err, results) {
                if (err) {
                    console.error(err);
                    next(err);
                }

                results.rows.forEach(function(r) {
                    var fam = {
                        fami: r.FAMI,
                        spouse: {
                            indi: r.INDI,
                            lname: r.LNAME,
                            fname: r.FNAME,
                            presumed: r.LIVING && !(req.session && req.session.user)
                        },
                        sources: r.source ? r.source.split(',') : [],
                        events: [],
                        children: []
                    };
                    indiRes.families.push(fam);
                });
                pool.release(conn);
                next(null, '5a');
            });
        });
    }

    function getPhotos(next) {
        //console.log('getPhotos');
        next(null, 6);
    }

    function getPedigree(next) {
        pool.acquire(function(err, conn) {
            if (err) {
                console.error(err);
                next(err);
            }

            var sql = `
with recursive
    family (indi, fname, lname, living, father, mother) as (
        select i.indi, i.fname, i.lname, i.living, f.husb, f.wife
          from indi i left join child c on i.indi=c.indi
          left join fami f on c.fami=f.fami
    ),
    parent_of (indi, fname, lname, living, parent, pindi) as (
        select indi, fname, lname, living, 'F', father from family
        UNION ALL
        select indi, fname, lname, living, 'M', mother from family
    ),
    ancestors (level, indi, fname, lname, living, parent, pindi, line) as (
        select 0, indi, fname, lname, living, parent, pindi, 'I'
          from parent_of where indi=?
        UNION ALL
        select level+1, P.indi, P.fname, P.lname, P.living, P.parent, P.pindi,
            line || A.parent
          from ancestors A join parent_of P on A.pindi=P.indi
         where level < 4 
    )
    select distinct level, indi, fname, lname, living, line
      from ancestors order by level, line`;

            var tree = {};

            function linkName(line, wid) {
                var d = tree[line];
                if (typeof d === 'undefined' || d[1].match(/^ *$/)) {
                    return '_'.repeat(wid+2);
                }
                else if (d[3] && !(req.session && req.session.user)) {
                    return '_Presumed Living' + '_'.repeat(wid-15);
                }
                else {
                    var more = d[2].length == 4 && (tree[d[2]+'F'] || tree[d[2]+'M']) ? '+' : '';
                    return '_' + '<a href="/' + dbName + '/indi/' + d[0] + '">' + d[1] + '</a>' +
                        '_'.repeat(wid+1-d[1].length) + more;
                }
            }

            conn.query(sql, [indi], function(err, results) {
                if (err) {
                    console.error(err);
                    next(err);
                }

                var len = [20, 20, 20, 20];
                results.rows.forEach(function(r) {
                    var name = r.fname + ' ' + r.lname;
                    var level = r.level==0 ? 1 : r.level;
                    if (name.length > len[level]) {
                        len[level] = name.length;
                    }
                    tree[r.line] = [r.indi, name, r.line, r.living];
                });
                pool.release(conn);

                var lines = [];
                lines.push(' '.repeat(len[1]+len[2]+6) + linkName('IFFF', len[3]));
                lines.push(' '.repeat(len[1]+4) + linkName('IFF', len[2]) + '|');
                lines.push(' '.repeat(len[1]+3) + '|' + ' '.repeat(len[2]+2) + '|' + linkName('IFFM', len[3]));
                lines.push(' ' + linkName('IF', len[1]) + '|');
                lines.push('|' + ' '.repeat(len[1]+2) + '|' + ' '.repeat(len[2]+3) + linkName('IFMF', len[3]));
                lines.push('|' + ' '.repeat(len[1]+2) + '|' + linkName('IFM', len[2]) + '|');
                lines.push('|' + ' '.repeat(len[1]+len[2]+5) + '|' + linkName('IFMM', len[3]));
                lines.push('|--' + linkName('I', len[1]));
                lines.push('|' + ' '.repeat(len[1]+len[2]+5) + ' ' + linkName('IMFF', len[3]));
                lines.push('|' +' '.repeat(len[1]+2) + ' ' + linkName('IMF', len[2]) + '|');
                lines.push('|' + ' '.repeat(len[1]+2) + '|' + ' '.repeat(len[2]+2) + '|' + linkName('IMFM', len[3]));
                lines.push('|' + linkName('IM', len[1]) + '|');
                lines.push(' '.repeat(len[1]+3) + '|' + ' '.repeat(len[2]+2) + ' ' + linkName('IMMF', len[3]));
                lines.push(' '.repeat(len[1]+3) + '|' + linkName('IMM', len[2]) + '|');
                lines.push(' '.repeat(len[1]+len[2]+6) + '|' + linkName('IMMM', len[3]));

                indiRes['pedigree'] = lines.join("\n");
                next(null, 7);
            });
        });
    }
};

module.exports = indiRouter;

/*

   Data to render individuals:

{
  "indi": "I0169",
  "sources": [],
  "stats": [
    {
      "name": "title",
      "data": null
    },
    {
      "name": "refn",
      "data": null
    },
    {
      "name": "sex",
      "data": "M"
    }
  ],
  "events": [
    {
      "etype": "Birth",
      "date": "6 APR 1951",
      "place": "Philadelphia, PA",
      "note": null,
      "text": null
    }
  ],
  "mother": {
    "indi": "I2910",
    "lname": "Coburn",
    "fname": "Carol Macy"
  },
  "father": {
    "indi": "I2788",
    "lname": "Woodbridge",
    "fname": "Joseph Eliot"
  },
  "families": [
    {
      "fami": "F1302",
      "spouse": {
        "indi": "I0225",
        "lname": "Fisher",
        "fname": "Karen Diane"
      },
      "events": [
        {
          "etype": "Marriage",
          "date": "28 JUN 1975",
          "place": "Melbourne, FL",
          "note": null,
          "text": null
        },
        {
          "etype": "Divorced",
          "date": "27 FEB 1989",
          "place": "Concord, MA",
          "note": null,
          "text": null
        },
        {
          "etype": "Divorced",
          "date": null,
          "place": null,
          "note": null,
          "text": null
        }
      ],
      "children": [
        {
          "indi": "I0236",
          "lname": "Woodbridge",
          "fname": "Jessica Amanda",
          "sex": "F"
        }
      ]
    },
    {
      "fami": "F1773",
      "spouse": {
        "indi": "I3483",
        "lname": "Meck",
        "fname": "Toni Lee"
      },
      "events": [
        {
          "etype": "Marriage",
          "date": "6 APR 1998",
          "place": "Chelmsford, MA",
          "note": null,
          "text": null
        }
      ],
      "children": []
    }
  ],
  "photos": [],
  "pedigree": "pedigree",
  "lname": "Woodbridge",
  "fname": "Stephen Eliot",
  "note": "NI0169"
}

*/



